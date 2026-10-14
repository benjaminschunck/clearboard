import {app, BrowserWindow, dialog, ipcMain} from "electron";
import * as fileSystem from "fs";
import * as path from "path";
import {pathToFileURL} from "url";

let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;

// Basis-Skin aus der Datei
const css = fileSystem.readFileSync(path.join(__dirname, "..", "skin", "clearboard.css"), "utf8");

// So sieht die settings.json aus. null heißt: nicht verändert, chess.com-Standard benutzen.
type Settings = {
    backgroundColor: string | null;
    boardLight: string | null;
    boardDark: string | null;
    accentColor: string | null;       // Farbe für Buttons, Logo und Highlights (statt chess.com-Grün)
    backgroundImage: string | null;   // Dateiname im userData-Ordner, z.B. "background.png"
    backgroundBlur: number;           // Weichzeichner in Pixeln
    backgroundDim: number;            // Abdunkeln des Bildes in Prozent (0 = Originalhelligkeit)
    panelOpacity: number;             // Deckkraft der Panels in Prozent
};

// Aktuelle Einstellungen (werden beim Start aus der settings.json geladen)
const settings: Settings = {
    backgroundColor: null,
    boardLight: null,
    boardDark: null,
    accentColor: null,
    backgroundImage: null,
    backgroundBlur: 12,
    backgroundDim: 20,
    panelOpacity: 100
};

// chess.coms Standard-Brett ("Green"), falls nur eine der beiden Brettfarben gewählt wurde
const DEFAULT_BOARD_LIGHT = "#ebecd0";
const DEFAULT_BOARD_DARK = "#739552";
// chess.coms Grün, solange keine eigene Akzentfarbe gewählt ist
const DEFAULT_ACCENT = "#81b64c";

// chess.com hat eine Grün-Palette von hell (50) bis dunkel (900), 300 ist das bekannte Button-Grün.
// Wir bauen dieselbe Palette aus der Akzentfarbe: hellere Stufen mit Weiß gemischt, dunklere mit Schwarz.
const GREEN_SHADES: [shade: number, mixWith: "white" | "black", amount: number][] = [
    [50, "white", 85], [75, "white", 70], [100, "white", 55], [200, "white", 25],
    [400, "black", 15], [500, "black", 30], [600, "black", 45],
    [700, "black", 60], [800, "black", 72], [900, "black", 82]
];

// Erlaubte Bild-Endungen und ihr MIME-Typ (braucht die data:-URL)
const IMAGE_TYPES: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif"
};
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

// ---------- Prüfen, was reinkommt ----------

// Nur echte Farbcodes wie #1a2b3c annehmen, damit kein beliebiges CSS reinkommt
const isColor = (value: unknown): value is string =>
    typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);

const isNumberBetween = (min: number, max: number) => (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

const isImageFileName = (value: unknown): value is string =>
    typeof value === "string" && /^background\.(png|jpe?g|webp|gif)$/.test(value);

// Für jede Einstellung eine Prüf-Funktion. Ein Record mit "keyof Settings" zwingt TypeScript,
// dass hier jede Einstellung vorkommt: Vergisst man eine, gibt's einen Fehler.
const validators: Record<keyof Settings, (value: unknown) => boolean> = {
    backgroundColor: isColor,
    boardLight: isColor,
    boardDark: isColor,
    accentColor: isColor,
    backgroundImage: isImageFileName,
    backgroundBlur: isNumberBetween(0, 40),
    backgroundDim: isNumberBetween(0, 90),
    panelOpacity: isNumberBetween(20, 100)
};
const settingKeys = Object.keys(validators) as (keyof Settings)[];

// Diese Einstellungen darf die Settings-Seite live über "set-setting" ändern.
// Das Bild nicht: Das läuft über den Datei-Dialog in main.ts, damit die Seite keine Pfade schicken kann.
const liveKeys: (keyof Settings)[] = ["backgroundColor", "boardLight", "boardDark", "accentColor", "backgroundBlur", "backgroundDim", "panelOpacity"];

// ---------- Speichern & Laden ----------

// Eigener Ordner pro Nutzer, unter Windows: AppData\Roaming\clearboard
const userFile = (name: string) => path.join(app.getPath("userData"), name);
const settingsPath = () => userFile("settings.json");

const loadSettings = () => {
    try {
        const data = JSON.parse(fileSystem.readFileSync(settingsPath(), "utf8"));
        for (const key of settingKeys) {
            if (validators[key](data[key])) {
                (settings as Record<string, unknown>)[key] = data[key];
            }
        }
        // Bild in den Einstellungen, aber Datei weg? Dann vergessen.
        if (settings.backgroundImage && !fileSystem.existsSync(userFile(settings.backgroundImage))) {
            settings.backgroundImage = null;
        }
    } catch {
        // Erster Start (Datei gibt's noch nicht) oder kaputte Datei: Standardwerte behalten
    }
};

const saveSettings = () => {
    fileSystem.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
};

// Was die Settings-Seite zu sehen bekommt: die Einstellungen plus eine URL fürs Vorschaubild
const settingsForPage = () => ({
    ...settings,
    // "?v=…" hängt eine Zahl an, damit das Fenster ein neues Bild nicht aus dem Cache nimmt
    backgroundImageUrl: settings.backgroundImage
        ? pathToFileURL(userFile(settings.backgroundImage)).href + "?v=" + Date.now()
        : null
});

// ---------- CSS aus den Einstellungen bauen ----------

// Baut ein 8×8-Schachbrett als SVG-Bild. chess.com erwartet in --theme-board-style-image
// ein Bild vom ganzen Brett, und ein SVG kann man direkt als Text in eine "data:"-URL packen.
const boardImage = (light: string, dark: string) => {
    let darkSquares = "";
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            // Oben links (a8) ist hell, also sind Felder mit ungerader Summe dunkel
            if ((x + y) % 2 === 1) {
                darkSquares += `M${x} ${y}h1v1h-1z`;
            }
        }
    }
    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" shape-rendering="crispEdges">` +
        `<rect width="8" height="8" fill="${light}"/>` +
        `<path fill="${dark}" d="${darkSquares}"/>` +
        `</svg>`;
    // encodeURIComponent macht aus Zeichen wie # und < etwas, das in einer URL erlaubt ist
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};

// Das kleine Theme-CSS: nur Variablen. Wird bei jeder Bewegung eines Reglers neu eingefügt.
const buildThemeCss = (): string => {
    // Ohne Bild bleiben die Panels deckend: Durchscheinend auf derselben Farbe würden sie nur verschwinden
    const alpha = settings.backgroundImage ? settings.panelOpacity : 100;
    const variables: string[] = [
        `--cb-blur: ${settings.backgroundBlur}px;`,
        // brightness() erwartet einen Faktor: 20 % abdunkeln heißt 0.8 der Helligkeit
        `--cb-brightness: ${(100 - settings.backgroundDim) / 100};`,
        `--cb-alpha: ${alpha}%;`
    ];

    if (settings.backgroundColor) {
        variables.push(`--theme-background-color: ${settings.backgroundColor};`);
    }

    if (settings.boardLight || settings.boardDark) {
        const light = settings.boardLight ?? DEFAULT_BOARD_LIGHT;
        const dark = settings.boardDark ?? DEFAULT_BOARD_DARK;
        variables.push(`--theme-board-style-image: url("${boardImage(light, dark)}");`);
        // Die Koordinaten (a–h, 1–8) stehen in der Farbe des jeweils anderen Feldes
        variables.push(`--theme-board-style-coordinate-color-light: ${light};`);
        variables.push(`--theme-board-style-coordinate-color-dark: ${dark};`);
    }

    // Die Akzentfarbe kommt ans html-Element statt an den body: chess.com rechnet Farben wie
    // --color-text-brand schon am html aus, und var() nimmt den Wert von dort, wo es steht.
    const accentVariables: string[] = [`--cb-accent: ${settings.accentColor ?? DEFAULT_ACCENT};`];
    if (settings.accentColor) {
        accentVariables.push(`--color-green-300: var(--cb-accent);`);
        for (const [shade, mixWith, amount] of GREEN_SHADES) {
            accentVariables.push(`--color-green-${shade}: color-mix(in srgb, var(--cb-accent) ${100 - amount}%, ${mixWith});`);
        }
    }

    // "html body" ist spezifischer als das "body" in clearboard.css und gewinnt deshalb.
    // chess.com setzt "dark-mode" auch an einzelne Bereiche innerhalb der Seite, deshalb dort nochmal.
    return `html body { ${variables.join(" ")} } ` +
        `html:root, html .dark-mode { ${accentVariables.join(" ")} }`;
};

// Das große Bild-CSS: enthält das ganze Bild als data:-URL (kann mehrere MB groß sein).
// Deshalb ein eigenes Stylesheet, das nur neu eingefügt wird, wenn sich das Bild ändert,
// nicht bei jeder Reglerbewegung.
const buildImageCss = (): string | null => {
    if (!settings.backgroundImage) return null;
    const extension = path.extname(settings.backgroundImage).slice(1).toLowerCase();
    const mimeType = IMAGE_TYPES[extension];
    if (!mimeType) return null;

    let base64: string;
    try {
        base64 = fileSystem.readFileSync(userFile(settings.backgroundImage)).toString("base64");
    } catch {
        return null;
    }

    return `
        /* chess.coms eigenen Hintergrund durchsichtig machen, damit das Bild darunter sichtbar ist */
        html body.theme-background {
            background-color: transparent;
            background-image: none;
        }
        /* Das Bild liegt in einer eigenen Ebene hinter allem (z-index: -1). So kann man es
           weichzeichnen, ohne dass die Seite selbst mit verschwimmt. Der negative Rand (inset)
           verhindert, dass der Blur an den Kanten helle Ränder zeigt. */
        html body::before {
            content: "";
            position: fixed;
            inset: calc(var(--cb-blur, 0px) * -2);
            z-index: -1;
            pointer-events: none;
            background: url("data:${mimeType};base64,${base64}") center / cover no-repeat;
            filter: blur(var(--cb-blur, 0px)) brightness(var(--cb-brightness, 0.8));
        }
    `;
};

// ---------- CSS auf chess.com anwenden ----------

// Ein Stylesheet, das man austauschen kann: merkt sich seinen insertCSS-Schlüssel und
// sorgt dafür, dass schnelle Änderungen nicht durcheinanderlaufen.
const createSwappableCss = (build: () => string | null) => {
    let key: string | null = null;
    let applying = false;    // läuft gerade ein Durchgang?
    let applyAgain = false;  // kam währenddessen eine neue Änderung rein?

    const apply = async () => {
        // Läuft schon ein Durchgang, nur merken, dass danach nochmal angewendet werden muss.
        // So werden Zwischenwerte beim Ziehen übersprungen, statt alle nacheinander abzuarbeiten.
        if (applying) {
            applyAgain = true;
            return;
        }
        applying = true;
        try {
            do {
                applyAgain = false;
                if (!mainWindow || mainWindow.isDestroyed()) break;
                const contents = mainWindow.webContents;
                const newCss = build();

                // Erst das neue CSS einfügen, dann das alte entfernen.
                // Andersrum gäbe es kurz einen Moment ganz ohne CSS, und genau das flackert.
                const oldKey = key;
                key = newCss ? await contents.insertCSS(newCss) : null;
                if (oldKey) {
                    await contents.removeInsertedCSS(oldKey);
                }
            } while (applyAgain);
        } finally {
            applying = false;
        }
    };

    // Nach dem Laden einer neuen Seite ist alles eingefügte CSS weg, der alte Schlüssel ungültig
    const forget = () => {
        key = null;
    };

    return { apply, forget };
};

const themeCss = createSwappableCss(buildThemeCss);
const imageCss = createSwappableCss(buildImageCss);

// ---------- Fenster ----------

const createWindow = () => {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        autoHideMenuBar: true,
        title: "Clearboard",
        webPreferences: {
            preload: path.join(__dirname, "preload.js")
        }
    });

    // Fenstertitel: Normalerweise übernimmt Electron den Seitentitel ("Home - Chess.com").
    // preventDefault() verhindert das, und wir setzen unseren eigenen ("Clearboard · Home").
    mainWindow.on("page-title-updated", (event, title) => {
        event.preventDefault();
        const page = title.replace(/\s*-\s*Chess\.com$/i, "");
        mainWindow?.setTitle(page ? `Clearboard · ${page}` : "Clearboard");
    });

    mainWindow.webContents.on("did-finish-load", () => {
        themeCss.forget();
        imageCss.forget();
        mainWindow?.webContents.insertCSS(css);
        imageCss.apply();
        themeCss.apply();
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
        backgroundColor: settings.backgroundColor ?? "#231a2e",
        webPreferences: {
            preload: path.join(__dirname, "settings-preload.js")
        }
    });
    settingsWindow.loadFile(path.join(__dirname, "..", "settings", "settings.html"));
};

// ---------- Hintergrundbild ----------

// Löscht alle alten background.*-Dateien (es könnte z.B. noch ein .jpg rumliegen, wenn jetzt ein .png kommt)
const deleteOldBackgrounds = () => {
    for (const extension of Object.keys(IMAGE_TYPES)) {
        fileSystem.rmSync(userFile(`background.${extension}`), { force: true });
    }
};

const chooseBackgroundImage = async () => {
    const parent = settingsWindow && !settingsWindow.isDestroyed() ? settingsWindow : undefined;
    const options: Electron.OpenDialogOptions = {
        title: "Hintergrundbild wählen",
        properties: ["openFile"],
        filters: [{ name: "Bilder", extensions: Object.keys(IMAGE_TYPES) }]
    };
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    const chosen = result.filePaths[0];
    if (result.canceled || !chosen) return settingsForPage();

    const extension = path.extname(chosen).slice(1).toLowerCase();
    if (!IMAGE_TYPES[extension]) return settingsForPage();
    if (fileSystem.statSync(chosen).size > MAX_IMAGE_BYTES) {
        dialog.showErrorBox("Bild zu groß", "Bitte ein Bild unter 20 MB wählen.");
        return settingsForPage();
    }

    // Eine Kopie in den App-Ordner legen. So geht nichts kaputt, wenn das Original verschoben wird.
    deleteOldBackgrounds();
    const fileName = `background.${extension}`;
    fileSystem.copyFileSync(chosen, userFile(fileName));

    settings.backgroundImage = fileName;
    saveSettings();
    imageCss.apply();
    themeCss.apply();   // --cb-alpha hängt davon ab, ob ein Bild da ist
    return settingsForPage();
};

const removeBackgroundImage = () => {
    deleteOldBackgrounds();
    settings.backgroundImage = null;
    saveSettings();
    imageCss.apply();
    themeCss.apply();
    return settingsForPage();
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

// Live-Vorschau: kommt bei jeder Bewegung in einem Farbwähler oder Regler
ipcMain.on("set-setting", (event, key, value) => {
    if (!liveKeys.includes(key) || !validators[key as keyof Settings](value)) return;
    (settings as Record<string, unknown>)[key] = value;
    themeCss.apply();
});

// Speichern: kommt erst, wenn ein Farbwähler oder Regler losgelassen wird
ipcMain.on("save-settings", () => {
    saveSettings();
});

// Mit Antwort: Die Settings-Seite fragt beim Öffnen die aktuellen Werte ab
ipcMain.handle("get-settings", () => settingsForPage());
ipcMain.handle("choose-background-image", () => chooseBackgroundImage());
ipcMain.handle("remove-background-image", () => removeBackgroundImage());

app.whenReady().then(() => {
    loadSettings();
    createWindow();
})
