import {ipcRenderer} from "electron";

window.addEventListener("DOMContentLoaded", () => {
    const button = document.createElement("button");
    button.textContent = "⚙";

    // Position: fest, unten rechts, über allem
    button.style.position = "fixed";
    button.style.bottom = "20px";
    button.style.right = "20px";
    button.style.zIndex = "9999";   // eine große Zahl, als String

    button.addEventListener("click", () => {
        ipcRenderer.send("open-settings");
    });

    document.body.appendChild(button);   // Kind an ein Element hängen
});