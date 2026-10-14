import {app, BrowserWindow} from "electron";
import * as fileSystem from "fs";
import * as path from "path";

const createWindow = () => {
    const window = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            preload: path.join(__dirname, "preload.js")
        }
    });

    window.webContents.on("did-finish-load", () => {
        window.webContents.insertCSS(css);
    });

    window.loadURL("https://www.chess.com/home");
}

const css = fileSystem.readFileSync(path.join(__dirname, "..", "skin", "clearboard.css"), "utf8");

app.whenReady().then(() => {    
    createWindow();
})