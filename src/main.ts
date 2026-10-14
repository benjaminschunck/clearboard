import {app, BrowserWindow} from "electron";
import * as fileSystem from "fs";

const createWindow = () => {
    const window = new BrowserWindow({
        width: 800,
        height: 600
    });

    window.webContents.on("did-finish-load", () => {
        window.webContents.insertCSS(css);
    });

    window.loadURL("https://www.chess.com/home");
}

const css = fileSystem.readFileSync("C:/dev/clearboard/skin/clearboard.css", "utf8");

app.whenReady().then(() => {    
    createWindow();
})

