/// The desktop app is a native window around the same SvelteKit build as the web and mobile apps.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running countx3");
}
