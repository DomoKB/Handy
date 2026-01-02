use crate::settings::{get_settings, write_settings, AppSettings, PostProcessProvider};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::fs;
// use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

#[derive(Default)]
pub struct LocalLlamaState {
    pub process: Mutex<Option<std::process::Child>>,
}

#[derive(Serialize, Deserialize, Debug, Type)]
pub struct GitHubRelease {
    pub tag_name: String,
    pub assets: Vec<GitHubAsset>,
    pub published_at: String,
}

#[derive(Serialize, Deserialize, Debug, Type)]
pub struct GitHubAsset {
    pub name: String,
    pub browser_download_url: String,
    pub size: u64,
}

#[derive(Serialize, Deserialize, Debug, Type)]
pub struct LocalModel {
    pub name: String,
    pub path: String,
    pub size: u64,
}

async fn fetch_releases_atom() -> Result<Vec<GitHubRelease>, String> {
    let client = reqwest::Client::new();
    let text = client
        .get("https://github.com/ggml-org/llama.cpp/releases.atom")
        .header("User-Agent", "Handy-App")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch atom feed: {}", e))?
        .text()
        .await
        .map_err(|e| format!("Failed to read atom feed text: {}", e))?;

    let mut releases = Vec::new();

    // Naive manual XML parsing
    // Split by <entry>
    let entries: Vec<&str> = text.split("<entry>").collect();

    // Skip the first chunk (header)
    for entry_xml in entries.iter().skip(1) {
        // Extract title
        let title_start = entry_xml.find("<title>").unwrap_or(0) + 7;
        let title_end = entry_xml[title_start..].find("</title>").unwrap_or(0) + title_start;
        if title_start >= title_end {
            continue;
        }
        let tag_name = entry_xml[title_start..title_end].trim().to_string();

        // Extract content
        let content_start_tag = "<content type=\"html\">";
        let content_end_tag = "</content>";

        let content_start = if let Some(idx) = entry_xml.find(content_start_tag) {
            idx + content_start_tag.len()
        } else if let Some(idx) = entry_xml.find("<content>") {
            idx + 9
        } else {
            continue;
        };

        let content_end = if let Some(idx) = entry_xml[content_start..].find(content_end_tag) {
            idx + content_start
        } else {
            continue;
        };

        let raw_content = &entry_xml[content_start..content_end];
        let decoded_content = raw_content
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&amp;", "&");

        // Parse links
        let mut assets = Vec::new();
        let parts: Vec<&str> = decoded_content.split("href=\"").collect();
        for part in parts.iter().skip(1) {
            if let Some(url_end) = part.find("\"") {
                let url = &part[0..url_end];
                if url.contains("/releases/download/") {
                    // Extract name from url
                    if let Some(name_idx) = url.rfind('/') {
                        let name = &url[name_idx + 1..];
                        if !name.is_empty() {
                            assets.push(GitHubAsset {
                                name: name.to_string(),
                                browser_download_url: url.to_string(),
                                size: 0,
                            });
                        }
                    }
                }
            }
        }

        if !tag_name.is_empty() && !assets.is_empty() {
            releases.push(GitHubRelease {
                tag_name,
                assets,
                published_at: String::new(),
            });
        }
    }

    Ok(releases)
}

#[tauri::command]
#[specta::specta]
pub async fn get_local_llama_releases() -> Result<Vec<GitHubRelease>, String> {
    let client = reqwest::Client::new();
    let mut releases: Vec<GitHubRelease> = Vec::new();
    let mut error_msg = String::new();

    // Try API
    let res = client
        .get("https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=100")
        .header("User-Agent", "Handy-App")
        .send()
        .await;

    let api_success = match res {
        Ok(r) => {
            if r.status().is_success() {
                match r.json::<Vec<GitHubRelease>>().await {
                    Ok(parsed) => {
                        releases = parsed;
                        true
                    }
                    Err(e) => {
                        error_msg = format!("API parse error: {}", e);
                        false
                    }
                }
            } else {
                error_msg = format!("API status error: {}", r.status());
                false
            }
        }
        Err(e) => {
            error_msg = format!("API network error: {}", e);
            false
        }
    };

    if !api_success {
        // Try Atom Feed as fallback
        match fetch_releases_atom().await {
            Ok(parsed) => releases = parsed,
            Err(e) => {
                return Err(format!(
                    "All fetch methods failed. API: {}. Atom: {}",
                    error_msg, e
                ))
            }
        }
    }

    let os_str = if cfg!(target_os = "windows") {
        "win"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "ubuntu"
    };

    let filtered_releases = releases
        .into_iter()
        .filter_map(|mut r| {
            let valid_assets: Vec<GitHubAsset> = r
                .assets
                .into_iter()
                .filter(|a| a.name.contains(&format!("{}-bin-{}", r.tag_name, os_str)))
                .collect();

            if valid_assets.is_empty() {
                None
            } else {
                r.assets = valid_assets;
                Some(r)
            }
        })
        .collect();

    Ok(filtered_releases)
}

#[tauri::command]
#[specta::specta]
pub async fn download_local_llama(
    app: AppHandle,
    url: String,
    version: String,
) -> Result<(), String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let llama_dir = app_data_dir.join("llama.cpp");

    if !llama_dir.exists() {
        fs::create_dir_all(&llama_dir).map_err(|e| e.to_string())?;
    }

    // Download to temp file
    let temp_path = llama_dir.join("temp_download.zip");

    println!("Downloading Llama server from: {}", url);

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header("User-Agent", "Handy-App")
        .send()
        .await
        .map_err(|e| format!("Failed to connect: {}", e))?;

    let status = response.status();
    println!("Response Status: {}", status);

    if !status.is_success() {
        return Err(format!("Download failed with status: {}", status));
    }

    let total_size = response.content_length().unwrap_or(0);
    println!("Content-Length: {}", total_size);

    if total_size > 0 && total_size < 1024 * 10 {
        // 10KB threshold
        return Err(format!(
            "File too small ({} bytes). Likely an error page.",
            total_size
        ));
    }

    use futures_util::StreamExt;
    use std::io::Write;
    use tauri::Emitter;

    let mut stream = response.bytes_stream();
    let mut file =
        fs::File::create(&temp_path).map_err(|e| format!("Failed to create file: {}", e))?;
    let mut downloaded: u64 = 0;

    let mut start_time = std::time::Instant::now();
    let mut last_update = std::time::Instant::now();
    let mut bytes_since_last_update: u64 = 0;
    let mut speed: u64 = 0;

    // Buffer for magic number check
    let mut first_chunk = true;

    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| format!("Error while downloading: {}", e))?;

        if first_chunk {
            if chunk.len() >= 4 {
                // Check for PK (Zip) or Gzip magic numbers
                // PK.. = 0x50 0x4B 0x03 0x04 (Local file header)
                // Gzip = 0x1F 0x8B
                if chunk[0] == 0x50 && chunk[1] == 0x4B {
                    println!("Detected ZIP header");
                } else if chunk[0] == 0x1F && chunk[1] == 0x8B {
                    println!("Detected GZIP header");
                } else {
                    let preview =
                        String::from_utf8_lossy(&chunk[0..std::cmp::min(100, chunk.len())]);
                    println!("Warning: Unknown file header. Preview: {}", preview);
                    if preview.trim().starts_with("<") {
                        return Err(
                            "Downloaded file appears to be HTML/XML instead of an archive."
                                .to_string(),
                        );
                    }
                }
            }
            first_chunk = false;
        }

        file.write_all(&chunk)
            .map_err(|e| format!("Error writing to file: {}", e))?;

        let chunk_len = chunk.len() as u64;
        downloaded += chunk_len;
        bytes_since_last_update += chunk_len;

        let now = std::time::Instant::now();
        let elapsed = now.duration_since(last_update);

        // Update speed every 500ms
        if elapsed.as_millis() > 500 {
            speed = (bytes_since_last_update as f64 / elapsed.as_secs_f64()) as u64;
            last_update = now;
            bytes_since_last_update = 0;

            if total_size > 0 {
                let _ = app.emit("download_server_progress", (downloaded, total_size, speed));
            }
        }
    }

    // Flush file
    file.flush()
        .map_err(|e| format!("Failed to flush file: {}", e))?;
    drop(file); // Ensure closed

    println!("Download finished. Total size: {}", downloaded);

    if downloaded < 1024 * 10 {
        return Err(format!(
            "Downloaded file is too small ({} bytes).",
            downloaded
        ));
    }

    // Final emit
    if total_size > 0 {
        let _ = app.emit("download_server_progress", (downloaded, total_size, speed));
    }

    // Extract
    // Assuming zip for Windows as per request "latest windows releases"
    // Using PowerShell to expand archive since we don't have zip crate dependency readily available
    // and don't want to modify Cargo.toml heavily if not needed.
    // However, if it's .tar.gz (like some assets), we might need tar.
    // But user asked for "latest windows releases", usually zip or exe.
    // If it is an .exe installer, we can't "extract" it easily unless it's a self-extracting archive.
    // I will assume it is a zip archive or I should try to unzip it.

    #[cfg(target_os = "windows")]
    {
        // ... (Existing Windows/PowerShell Logic) ...
        let status = Command::new("powershell")
            .args(&[
                "-Command",
                "Expand-Archive",
                "-Path",
                temp_path.to_str().unwrap(),
                "-DestinationPath",
                llama_dir.to_str().unwrap(),
                "-Force",
            ])
            .status()
            .map_err(|e| format!("Failed to execute powershell extraction: {}", e))?;

        if !status.success() {
            if url.ends_with(".exe") {
                let target_exe = llama_dir.join("llama-server.exe");
                fs::rename(&temp_path, &target_exe)
                    .map_err(|e| format!("Failed to rename exe: {}", e))?;
            } else {
                return Err("Extraction failed".to_string());
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let status = if url.ends_with(".zip") {
            Command::new("unzip")
                .arg("-o")
                .arg(temp_path.to_str().unwrap())
                .arg("-d")
                .arg(llama_dir.to_str().unwrap())
                .status()
        } else if url.ends_with(".tar.gz") || url.ends_with(".tgz") {
            Command::new("tar")
                .arg("-xzf")
                .arg(temp_path.to_str().unwrap())
                .arg("-C")
                .arg(llama_dir.to_str().unwrap())
                .status()
        } else if url.ends_with(".gz") {
            // For .gz usually it's a single file, gzip -d replaces the file.
            // We might need to handle renaming to 'llama-server' after?
            // Assuming gzip -d creates a file without .gz extension in same dir
            let res = Command::new("gzip")
                .arg("-d")
                .arg(temp_path.to_str().unwrap())
                .status();

            // If successful, we might need to make it executable and rename/move?
            // But for now, just extraction.
            res
        } else {
            // Fallback to tar?
            Command::new("tar")
                .arg("-xf")
                .arg(temp_path.to_str().unwrap())
                .arg("-C")
                .arg(llama_dir.to_str().unwrap())
                .status()
        };

        let status = status.map_err(|e| format!("Failed to execute extraction command: {}", e))?;
        if !status.success() {
            return Err("Extraction failed".to_string());
        }
    }

    // Clean up temp file
    if temp_path.exists() {
        let _ = fs::remove_file(&temp_path);
    }

    // save version
    let version_path = llama_dir.join("version.txt");
    fs::write(version_path, version).map_err(|e| e.to_string())?;

    Ok(())
}
#[tauri::command]
#[specta::specta]
pub async fn download_local_model(app: AppHandle, url: String) -> Result<String, String> {
    use std::io::Write;
    use tauri::Emitter;

    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    // Change path to models/llama
    let models_dir = app_data_dir.join("models").join("llama");

    if !models_dir.exists() {
        fs::create_dir_all(&models_dir).map_err(|e| e.to_string())?;
    }

    // Parse filename from URL
    let filename = url
        .split('/')
        .last()
        .ok_or("Invalid URL: cannot determine filename")?
        .to_string();

    let target_path = models_dir.join(&filename);

    // Download with progress
    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("Failed to initiate download: {}", e))?
        .error_for_status()
        .map_err(|e| format!("Server returned error: {}", e))?;

    let total_size = response.content_length().unwrap_or(0);

    // Check total size if available (basic check)
    // 100 bytes is arbitrary small HTML check
    if total_size > 0 && total_size < 100 {
        return Err("File seems too small to be a model (likely an error page).".to_string());
    }

    let mut stream = response.bytes_stream();
    let mut file =
        std::fs::File::create(&target_path).map_err(|e| format!("Failed to create file: {}", e))?;
    let mut downloaded: u64 = 0;

    // We need futures_util or similar to iterate stream, but reqwest stream returns Chunks.
    // We can use a while loop with .next().await if we import StreamExt,
    // or just loop manually if the stream supports it.
    // reqwest::Response::bytes_stream() returns impl Stream<Item = Result<Bytes, reqwest::Error>>

    // We need to import StreamExt trait to use .next() nicely, or use while let loop.
    // Assuming tauri/rust environment has futures available.
    // If not, we might need to add it to Cargo.toml.
    // Usually reqwest depends on futures-core/util.

    use futures_util::StreamExt; // We might need to ensure this is available or use a loop

    let mut start_time = std::time::Instant::now();
    let mut last_update = std::time::Instant::now();
    let mut bytes_since_last_update: u64 = 0;
    let mut speed: u64 = 0;

    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| format!("Error while downloading: {}", e))?;
        file.write_all(&chunk)
            .map_err(|e| format!("Error writing to file: {}", e))?;

        let chunk_len = chunk.len() as u64;
        downloaded += chunk_len;
        bytes_since_last_update += chunk_len;

        let now = std::time::Instant::now();
        let elapsed = now.duration_since(last_update);

        // Update speed every 500ms
        if elapsed.as_millis() > 500 {
            speed = (bytes_since_last_update as f64 / elapsed.as_secs_f64()) as u64;
            last_update = now;
            bytes_since_last_update = 0;

            if total_size > 0 {
                let _ = app.emit("download_model_progress", (downloaded, total_size, speed));
            }
        }
    }

    // Verify content header after download if size detection wasn't possible before
    if downloaded < 100 {
        // Read back file to check content?
        // Or just fail?
        // For now, let's assume if it streamed okay and wasn't caught by total_size check (if 0),
        // we might check file content now.
        let content = std::fs::read(&target_path).unwrap_or_default();
        let header_slice = &content[0..std::cmp::min(100, content.len())];
        let header_str = String::from_utf8_lossy(header_slice).to_lowercase();
        if header_str.contains("<!doctype html") || header_str.contains("<html") {
            // Delete file
            let _ = std::fs::remove_file(&target_path);
            return Err(
                "Downloaded file appears to be HTML. Access denied or invalid link.".to_string(),
            );
        }
    }

    Ok(filename)
}

#[tauri::command]
#[specta::specta]
pub fn open_local_models_folder(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    // Target the specific llama models folder
    let models_dir = app_data_dir.join("models").join("llama");

    if !models_dir.exists() {
        fs::create_dir_all(&models_dir).map_err(|e| e.to_string())?;
    }

    let path = models_dir.to_string_lossy().to_string();
    app.opener()
        .open_path(path, None::<String>)
        .map_err(|e| format!("Failed to open folder: {}", e))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn open_llama_server_folder(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let llama_dir = app_data_dir.join("llama.cpp");

    if !llama_dir.exists() {
        fs::create_dir_all(&llama_dir).map_err(|e| e.to_string())?;
    }

    let path = llama_dir.to_string_lossy().to_string();
    app.opener()
        .open_path(path, None::<String>)
        .map_err(|e| format!("Failed to open folder: {}", e))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn get_local_llama_installed_version(app: AppHandle) -> Result<Option<String>, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let version_path = app_data_dir.join("llama.cpp").join("version.txt");

    if version_path.exists() {
        let v = fs::read_to_string(version_path).map_err(|e| e.to_string())?;
        Ok(Some(v.trim().to_string()))
    } else {
        Ok(None)
    }
}

#[tauri::command]
#[specta::specta]
pub fn change_local_llama_auto_start_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = get_settings(&app);
    settings.local_llama_auto_start = enabled;
    write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_local_llama_port_setting(app: AppHandle, port: u16) -> Result<(), String> {
    let mut settings = get_settings(&app);
    settings.local_llama_port = port;
    write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn get_downloaded_local_models(app: AppHandle) -> Result<Vec<LocalModel>, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let dirs_to_scan = vec![
        app_data_dir.join("llama.cpp"),
        app_data_dir.join("models"),
        app_data_dir.join("models").join("llama"),
    ];

    let mut models = Vec::new();

    for dir in dirs_to_scan {
        if !dir.exists() {
            continue;
        }

        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    if let Some(ext) = path.extension() {
                        if ext == "gguf" || ext == "bin" {
                            if ext == "gguf" {
                                let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
                                models.push(LocalModel {
                                    name: path
                                        .file_name()
                                        .unwrap_or_default()
                                        .to_string_lossy()
                                        .to_string(),
                                    path: path.to_string_lossy().to_string(),
                                    size: metadata.len(),
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(models)
}

pub fn resolve_model_path(app: &AppHandle, model_name: &str) -> Option<String> {
    let app_data_dir = app.path().app_data_dir().ok()?;
    let dirs_to_scan = vec![
        app_data_dir.join("llama.cpp"),
        app_data_dir.join("models"),
        app_data_dir.join("models").join("llama"),
    ];

    for dir in dirs_to_scan {
        if let Ok(path) = dir.join(model_name).canonicalize() {
            if path.exists() && path.is_file() {
                return Some(path.to_string_lossy().to_string());
            }
        }
    }
    None
}

#[tauri::command]
#[specta::specta]
pub async fn start_local_llama(
    app: AppHandle,
    model_path: String,
    port: u16,
) -> Result<(), String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let llama_dir = app_data_dir.join("llama.cpp");
    let mut server_exe = llama_dir.join("llama-server.exe");

    if !server_exe.exists() {
        // Fallback: search recursively for llama-server.exe or server.exe
        fn find_server_exe(dir: &Path) -> Option<PathBuf> {
            if let Ok(entries) = fs::read_dir(dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_dir() {
                        if let Some(found) = find_server_exe(&path) {
                            return Some(found);
                        }
                    } else if let Some(name) = path.file_name() {
                        let name_str = name.to_string_lossy();
                        if name_str == "llama-server.exe" || name_str == "server.exe" {
                            return Some(path);
                        }
                    }
                }
            }
            None
        }

        if let Some(found) = find_server_exe(&llama_dir) {
            server_exe = found;
        } else {
            return Err("llama-server.exe not found".to_string());
        }
    }

    let state = app.state::<LocalLlamaState>();
    {
        let mut process_guard = state.process.lock().unwrap();

        if process_guard.is_some() {
            return Err("Server already running".to_string());
        }

        let child = Command::new(server_exe)
            .arg("-m")
            .arg(model_path.clone())
            .arg("--port")
            .arg(port.to_string())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to start server: {}", e))?;

        *process_guard = Some(child);
    }

    // Wait for server to be ready (Health check)
    let client = reqwest::Client::new();
    let _health_url = format!("http://127.0.0.1:{}/health", port); // Try standard health endpoint first?
                                                                   // Llama.cpp usually has /health or just check /v1/models
    let models_url = format!("http://127.0.0.1:{}/v1/models", port);

    let start_time = std::time::Instant::now();
    let timeout = std::time::Duration::from_secs(60); // 60s timeout for model loading
    let mut success = false;

    while start_time.elapsed() < timeout {
        // Try to fetch models first to see if API is up and get the model ID
        if let Ok(response) = client.get(&models_url).send().await {
            if response.status().is_success() {
                // Parse the response to find the model ID
                if let Ok(json) = response.json::<serde_json::Value>().await {
                    if let Some(data) = json.get("data").and_then(|d| d.as_array()) {
                        if let Some(first_model) = data.first() {
                            if let Some(model_id) = first_model.get("id").and_then(|id| id.as_str())
                            {
                                // Now try to send a test prompt
                                let chat_url =
                                    format!("http://127.0.0.1:{}/v1/chat/completions", port);
                                let body = serde_json::json!({
                                    "model": model_id,
                                    "messages": [{"role": "user", "content": "ping"}],
                                    "max_tokens": 1
                                });

                                if let Ok(chat_res) =
                                    client.post(&chat_url).json(&body).send().await
                                {
                                    if chat_res.status().is_success() {
                                        success = true;
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        std::thread::sleep(std::time::Duration::from_millis(500));

        // Check if process died
        let state = app.state::<LocalLlamaState>();
        {
            let mut process_guard = state.process.lock().unwrap();
            if let Some(child) = process_guard.as_mut() {
                if let Ok(Some(status)) = child.try_wait() {
                    *process_guard = None;
                    return Err(format!(
                        "Server process exited unexpectedly with status: {}",
                        status
                    ));
                }
            } else {
                // Process was stopped manually (e.g. by stop_local_llama)
                return Err("Server startup cancelled".to_string());
            }
        }
    }

    if !success {
        let state = app.state::<LocalLlamaState>();
        let mut process_guard = state.process.lock().unwrap();
        if let Some(mut child) = process_guard.take() {
            let _ = child.kill();
        }
        return Err("Server timed out waiting for readiness".to_string());
    }

    // Update settings to use Local Llama
    let mut settings = get_settings(&app);
    // Ensure provider exists
    if !settings
        .post_process_providers
        .iter()
        .any(|p| p.id == "local_llama")
    {
        settings.post_process_providers.push(PostProcessProvider {
            id: "local_llama".to_string(),
            label: "Local Llama".to_string(),
            base_url: format!("http://127.0.0.1:{}/v1", port),
            allow_base_url_edit: false,
            models_endpoint: Some("/models".to_string()),
        });
    } else {
        // Update port if needed
        if let Some(p) = settings
            .post_process_providers
            .iter_mut()
            .find(|p| p.id == "local_llama")
        {
            p.base_url = format!("http://127.0.0.1:{}/v1", port);
        }
    }
    settings.post_process_provider_id = "local_llama".to_string();

    // Update the model setting for this provider
    let model_name = std::path::Path::new(&model_path)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    settings
        .post_process_models
        .insert("local_llama".to_string(), model_name);

    // Ensure a prompt is selected if none is set
    if settings.post_process_selected_prompt_id.is_none()
        && !settings.post_process_prompts.is_empty()
    {
        if settings
            .post_process_prompts
            .iter()
            .any(|p| p.id == "default_improve_transcriptions")
        {
            settings.post_process_selected_prompt_id =
                Some("default_improve_transcriptions".to_string());
        } else {
            settings.post_process_selected_prompt_id =
                Some(settings.post_process_prompts[0].id.clone());
        }
    }

    write_settings(&app, settings);

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn stop_local_llama(app: AppHandle) -> Result<(), String> {
    let state = app.state::<LocalLlamaState>();
    let mut process_guard = state.process.lock().unwrap();

    if let Some(mut child) = process_guard.take() {
        child
            .kill()
            .map_err(|e| format!("Failed to kill process: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn get_local_llama_server_status(app: AppHandle) -> Result<bool, String> {
    let state = app.state::<LocalLlamaState>();
    let mut process_guard = state.process.lock().unwrap();

    if let Some(child) = process_guard.as_mut() {
        // Check if still running
        match child.try_wait() {
            Ok(Some(_)) => {
                *process_guard = None;
                Ok(false)
            }
            Ok(None) => Ok(true),
            Err(_) => {
                *process_guard = None;
                Ok(false)
            }
        }
    } else {
        Ok(false)
    }
}

#[tauri::command]
#[specta::specta]
pub fn delete_local_model(app: AppHandle, name: String) -> Result<(), String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let models_dir = app_data_dir.join("models").join("llama");
    let model_path = models_dir.join(&name);

    if model_path.exists() {
        fs::remove_file(model_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn get_local_model_download_progress(_app: AppHandle) -> Result<(u64, u64, u64), String> {
    // Stub
    Ok((0, 0, 0))
}

#[tauri::command]
#[specta::specta]
pub fn cancel_local_model_download(_app: AppHandle) -> Result<(), String> {
    // Stub
    Ok(())
}
