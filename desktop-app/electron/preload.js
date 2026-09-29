import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("desktop", {
  platform: process.platform,

  getPlatform() {
    return process.platform;
  },
});