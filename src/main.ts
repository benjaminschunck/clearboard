import {app, BrowserWindow, ipcMain} from "electron";
import * as fileSystem from "fs";
import * as path from "path";

let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;

// Basis-Skin aus der Datei
const css = fileSystem.readFileSync(path.join(__dirname, "..", "skin", "clearboard.css"), "utf8");

// So sieht die settings.json aus
type Settings = {
    backgroundColor: string | null;
};

// Aktuelle Einstellungen (werden beim Start aus der settings.json geladen)
let backgroundColor: string | null = null;
// Schlüssel, den insertCSS für das Farb-CSS zurückgibt, um es später wieder zu entfernen
let colorCssKey: string | null = null;

// Nur echte Farbcodes wie #1a2b3c annehmen, damit kein beliebiges CSS reinkommt
const isColor = (value: unknown): value is string =>
    typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);

// ---------- Speichern & Laden ----------

// Eigener Ordner pro Nutzer, unter Windows: AppData\Roaming\clearboard
const settingsPath = () => path.join(app.getPath("userData"), "settings.json");

const loadSettings = () => {
    try {
        const data = JSON.parse(fileSystem.readFileSync(settingsPath(), "utf8"));
        if (isColor(data.backgroundColor)) {
            backgroundColor = data.backgroundColor;
        }
    } catch {
        // Erster Start (Datei gibt's noch nicht) oder kaputte Datei: Standardwerte behalten
    }
};

const saveSettings = () => {
    const settings: Settings = { backgroundColor };
    fileSystem.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
};

// ---------- Farbe auf chess.com anwenden ----------

let applying = false;    // läuft gerade ein Durchgang?
let applyAgain = false;  // kam währenddessen eine neue Farbe rein?

const applyBackground = async () => {
    // Läuft schon ein Durchgang, nur merken, dass danach nochmal angewendet werden muss.
    // So werden Zwischenfarben beim Ziehen übersprungen, statt alle nacheinander abzuarbeiten.
    if (applying) {
        applyAgain = true;
        return;
    }
    applying = true;
    try {
        do {
            applyAgain = false;
            if (!mainWindow || mainWindow.isDestroyed() || !backgroundColor) break;
            const contents = mainWindow.webContents;

            // Erst das neue CSS einfügen, dann das alte entfernen.
            // Andersrum gäbe es kurz einen Moment ganz ohne Farb-CSS, und genau das flackert.
            const oldKey = colorCssKey;
            // "html body" ist spezifischer als das "body" in clearboard.css und gewinnt deshalb
            colorCssKey = await contents.insertCSS(`html body { --theme-background-color: ${backgroundColor}; }`);
            if (oldKey) {
                await contents.removeInsertedCSS(oldKey);
            }
        } while (applyAgain);
    } finally {
        applying = false;
    }
};

// ---------- Fenster ----------

const createWindow = () => {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, "preload.js")
        }
    });

    mainWindow.webContents.on("did-finish-load", () => {
        // Neue Seite = alles eingefügte CSS ist weg, also auch der alte Schlüssel ungültig
        colorCssKey = null;
        mainWindow?.webContents.insertCSS(css);
        applyBackground();
    });

    mainWindow.loadURL("https://www.chess.com/home");
}

const createSettingsWindow = () => {
    settingsWindow = new BrowserWindow({
        width: 400,
        height: 600,
        autoHideMenuBar: true,
        title: "Clearboard Settings",
        // Fensterfarbe, bis die Seite geladen ist, sonst blitzt es kurz weiß auf
        backgroundColor: backgroundColor ?? "#231a2e",
        webPreferences: {
            preload: path.join(__dirname, "settings-preload.js")
        }
    });
    settingsWindow.loadFile(path.join(__dirname, "..", "settings", "settings.html"));
};

// ---------- IPC ----------

ipcMain.on("open-settings", () => {
    //if window already is open, focus it instead of creating a new one
    if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.focus();
    } else {
        createSettingsWindow();
    }
});

// Live-Vorschau: kommt bei jeder Bewegung im Farbwähler
ipcMain.on("set-background", (event, color) => {
    if (!isColor(color)) return;
    backgroundColor = color;
    applyBackground();
});

// Speichern: kommt erst, wenn der Farbwähler losgelassen/geschlossen wird
ipcMain.on("save-settings", () => {
    saveSettings();
});

// Mit Antwort: Die Settings-Seite fragt beim Öffnen die aktuellen Werte ab
ipcMain.handle("get-settings", (): Settings => {
    return { backgroundColor };
});

app.whenReady().then(() => {
    loadSettings();
    createWindow();
})
