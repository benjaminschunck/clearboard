import {contextBridge, ipcRenderer} from "electron";

// Gibt der Settings-Seite genau diese Funktionen frei, unter window.clearboard
contextBridge.exposeInMainWorld("clearboard", {
    // Live-Vorschau einer Einstellung, ohne zu speichern (z.B. "boardLight", "#ffffff")
    setSetting: (key: string, value: string | number) => ipcRenderer.send("set-setting", key, value),
    // Aktuellen Stand in die settings.json schreiben
    saveSettings: () => ipcRenderer.send("save-settings"),
    // invoke statt send: wartet auf die Antwort von ipcMain.handle (gibt ein Promise zurück)
    getSettings: () => ipcRenderer.invoke("get-settings"),
    // Öffnet den Datei-Dialog in main.ts. Die Seite bekommt danach nur die neuen Einstellungen zurück.
    chooseBackgroundImage: () => ipcRenderer.invoke("choose-background-image"),
    removeBackgroundImage: () => ipcRenderer.invoke("remove-background-image")
});
