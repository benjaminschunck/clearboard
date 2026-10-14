import {contextBridge, ipcRenderer} from "electron";

// Gibt der Settings-Seite genau diese Funktionen frei, unter window.clearboard
contextBridge.exposeInMainWorld("clearboard", {
    // Live-Vorschau, ohne zu speichern
    setBackground: (color: string) => ipcRenderer.send("set-background", color),
    // Aktuellen Stand in die settings.json schreiben
    saveSettings: () => ipcRenderer.send("save-settings"),
    // invoke statt send: wartet auf die Antwort von ipcMain.handle (gibt ein Promise zurück)
    getSettings: () => ipcRenderer.invoke("get-settings")
});
