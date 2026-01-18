use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

const CONFIG_FILENAME: &str = "config.json";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GpuServerConfig {
    pub host: String,
    pub port: u16,
    pub use_ssl: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ApiKeysConfig {
    pub openai: String,
    pub fal: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FeaturesConfig {
    pub prompt_sanitizer: bool,
    pub seed_generation: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    pub gpu_server: GpuServerConfig,
    pub api_keys: ApiKeysConfig,
    pub features: FeaturesConfig,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            gpu_server: GpuServerConfig {
                host: "localhost".to_string(),
                port: 8082,
                use_ssl: false,
            },
            api_keys: ApiKeysConfig {
                openai: String::new(),
                fal: String::new(),
            },
            features: FeaturesConfig {
                prompt_sanitizer: true,
                seed_generation: false,
            },
        }
    }
}

fn get_config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Failed to get app config dir: {}", e))?;

    // Create config directory if it doesn't exist
    if !config_dir.exists() {
        fs::create_dir_all(&config_dir)
            .map_err(|e| format!("Failed to create config dir: {}", e))?;
    }

    Ok(config_dir.join(CONFIG_FILENAME))
}

#[tauri::command]
fn read_config(app: tauri::AppHandle) -> Result<AppConfig, String> {
    let config_path = get_config_path(&app)?;

    if !config_path.exists() {
        // Create default config file
        let default_config = AppConfig::default();
        let json = serde_json::to_string_pretty(&default_config)
            .map_err(|e| format!("Failed to serialize default config: {}", e))?;
        fs::write(&config_path, json)
            .map_err(|e| format!("Failed to write default config: {}", e))?;
        return Ok(default_config);
    }

    let content = fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config file: {}", e))?;

    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse config file: {}", e))
}

#[tauri::command]
fn write_config(app: tauri::AppHandle, config: AppConfig) -> Result<(), String> {
    let config_path = get_config_path(&app)?;

    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    fs::write(&config_path, json)
        .map_err(|e| format!("Failed to write config file: {}", e))
}

#[tauri::command]
fn get_config_path_str(app: tauri::AppHandle) -> Result<String, String> {
    let config_path = get_config_path(&app)?;
    Ok(config_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn open_config(app: tauri::AppHandle) -> Result<(), String> {
    let config_path = get_config_path(&app)?;

    // Ensure config file exists before opening
    if !config_path.exists() {
        // Create default config if it doesn't exist
        let default_config = AppConfig::default();
        let json = serde_json::to_string_pretty(&default_config)
            .map_err(|e| format!("Failed to serialize default config: {}", e))?;
        fs::write(&config_path, json)
            .map_err(|e| format!("Failed to write default config: {}", e))?;
    }

    // Open with default application using tauri-plugin-opener
    tauri_plugin_opener::open_path(config_path, None::<&str>)
        .map_err(|e| format!("Failed to open config file: {}", e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            read_config,
            write_config,
            get_config_path_str,
            open_config
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
