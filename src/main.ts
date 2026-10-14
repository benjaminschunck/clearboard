import {app, BrowserWindow} from "electron";

const createWindow = () => {
    const window = new BrowserWindow({
        width: 800,
        height: 600
    });
    window.loadURL("https://www.chess.com/home");
}

app.whenReady().then(() => {
    createWindow();
})