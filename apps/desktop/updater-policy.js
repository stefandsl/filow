"use strict";

const fs = require("node:fs");
const path = require("node:path");

const UPDATER_POLICY = Object.freeze({
  allowDowngrade: false,
  autoDownload: true,
  autoInstallOnAppQuit: false,
});

const RECHECK_TIMEOUT_MS = 10_000;

function configureUpdater(updater) {
  updater.allowDowngrade = UPDATER_POLICY.allowDowngrade;
  updater.autoDownload = UPDATER_POLICY.autoDownload;
  updater.autoInstallOnAppQuit = UPDATER_POLICY.autoInstallOnAppQuit;
  return updater;
}

function extractDownloadedInfo(updater, info) {
  const helper = updater && updater.downloadedUpdateHelper;
  const helperInfo = helper && helper.downloadedFileInfo;
  const version = typeof info?.version === "string" ? info.version.trim() : "";
  const downloadedFile =
    (typeof info?.downloadedFile === "string" && info.downloadedFile) ||
    (typeof helper?.file === "string" && helper.file) ||
    "";
  const fileName =
    (typeof helperInfo?.fileName === "string" && helperInfo.fileName) ||
    (downloadedFile ? path.basename(downloadedFile) : "");
  const firstFileSha = Array.isArray(info?.files)
    ? info.files.find((entry) => typeof entry?.sha512 === "string" && entry.sha512)?.sha512 || ""
    : "";
  const sha512 =
    (typeof helperInfo?.sha512 === "string" && helperInfo.sha512) ||
    (typeof info?.sha512 === "string" && info.sha512) ||
    firstFileSha;
  return { version, sha512, fileName, downloadedFile };
}

function matchesOfferedUpdate(downloaded, checkResult) {
  if (!downloaded || !downloaded.version || !downloaded.sha512) return false;
  if (!checkResult || checkResult.isUpdateAvailable === false) return false;
  const offered = checkResult.updateInfo || checkResult.versionInfo;
  if (!offered || typeof offered.version !== "string" || offered.version !== downloaded.version) {
    return false;
  }
  if (Array.isArray(offered.files) && offered.files.length > 0) {
    const hasUrls = offered.files.some((entry) => typeof entry?.url === "string" && entry.url.length > 0);
    if (downloaded.fileName && hasUrls) {
      const exact = offered.files.find(
        (entry) => typeof entry?.url === "string" && path.basename(entry.url) === downloaded.fileName
      );
      return Boolean(exact && exact.sha512 === downloaded.sha512);
    }
    return offered.files.some((entry) => entry?.sha512 === downloaded.sha512);
  }
  return typeof offered.sha512 === "string" && offered.sha512 === downloaded.sha512;
}

async function discardDownloadedUpdate(updater, downloaded, fsMod = fs) {
  const helper = updater && updater.downloadedUpdateHelper;
  if (helper && typeof helper.clear === "function") {
    try {
      await helper.clear();
    } catch {
      /* ignore cache cleanup errors */
    }
    if ("_downloadedFileInfo" in helper) helper._downloadedFileInfo = null;
  }
  if (downloaded?.downloadedFile && fsMod && typeof fsMod.rmSync === "function") {
    try {
      fsMod.rmSync(downloaded.downloadedFile, { force: true });
    } catch {
      /* ignore file removal errors */
    }
  }
}

function withTimeout(promise, ms) {
  let timer = null;
  return new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`Update recheck timed out after ${ms} ms`);
      err.code = "ETIMEDOUT";
      reject(err);
    }, ms);
    if (typeof timer.unref === "function") timer.unref();
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function createUpdaterGuard({
  updater,
  app,
  isOffline = () => false,
  timeoutMs = RECHECK_TIMEOUT_MS,
  onRecalled,
  onUnconfirmed,
  onInstalled,
  onLog,
  fs: fsMod = fs,
}) {
  configureUpdater(updater);
  let downloaded = null;
  let recheckDepth = 0;
  let savedAutoDownload = UPDATER_POLICY.autoDownload;
  let pendingInstall = null;
  let installing = false;
  let quitBypass = false;
  let quitAfterPending = false;

  function recordDownloaded(info) {
    downloaded = extractDownloadedInfo(updater, info);
    quitBypass = false;
    return downloaded;
  }

  async function recheckFeed(current) {
    if (isOffline()) return { status: "unconfirmed", reason: "offline" };
    if (recheckDepth === 0) {
      savedAutoDownload = updater.autoDownload;
      updater.autoDownload = false;
    }
    recheckDepth += 1;
    const raw = Promise.resolve().then(() => updater.checkForUpdates());
    raw.catch(() => {}).finally(() => {
      recheckDepth -= 1;
      if (recheckDepth === 0) updater.autoDownload = savedAutoDownload;
    });
    try {
      const result = await withTimeout(raw, timeoutMs);
      const offered = result && (result.updateInfo || result.versionInfo);
      if (!result || !offered) return { status: "unconfirmed", reason: "empty" };
      if (matchesOfferedUpdate(current, result)) return { status: "confirmed", result, offered };
      return { status: "recalled", result, offered };
    } catch (err) {
      return {
        status: "unconfirmed",
        reason: err?.code === "ETIMEDOUT" ? "timeout" : "error",
        error: err,
      };
    }
  }

  function install({ isSilent, isForceRunAfter, onQuit = false } = {}) {
    if (installing) return Promise.resolve({ installed: true, reason: "already-installing" });
    if (pendingInstall) {
      if (onQuit) quitAfterPending = true;
      return pendingInstall;
    }
    const current = downloaded;
    if (!current || !current.version) {
      if (onQuit) {
        quitBypass = true;
        app.quit();
      }
      return Promise.resolve({ installed: false, reason: "none" });
    }
    const run = (async () => {
      const outcome = await recheckFeed(current);
      const shouldQuit = onQuit || quitAfterPending;
      if (outcome.status === "confirmed") {
        installing = true;
        downloaded = null;
        onLog?.(`update: recheck confirmed ${current.version}; installing`);
        onInstalled?.(current, { onQuit: shouldQuit });
        if (isSilent === undefined && isForceRunAfter === undefined) updater.quitAndInstall();
        else updater.quitAndInstall(Boolean(isSilent), Boolean(isForceRunAfter));
        return { installed: true, reason: "confirmed", version: current.version };
      }
      if (outcome.status === "recalled") {
        await discardDownloadedUpdate(updater, current, fsMod);
        downloaded = null;
        const offeredVersion = outcome.offered?.version || "";
        onLog?.(`update: ${current.version} was recalled (feed offers ${offeredVersion || "none"}); discarded`);
        onRecalled?.(current, outcome.offered, { onQuit: shouldQuit });
        if (shouldQuit) {
          quitBypass = true;
          app.quit();
        }
        return { installed: false, reason: "recalled", version: current.version, offeredVersion };
      }
      if (shouldQuit) downloaded = null;
      onLog?.(`update: could not confirm ${current.version} (${outcome.reason}); skipped install`);
      onUnconfirmed?.(current, outcome.reason, { onQuit: shouldQuit });
      if (shouldQuit) {
        quitBypass = true;
        app.quit();
      }
      return { installed: false, reason: outcome.reason, version: current.version };
    })().finally(() => {
      pendingInstall = null;
      quitAfterPending = false;
    });
    pendingInstall = run;
    return run;
  }

  function handleBeforeQuit(event) {
    if (installing || quitBypass) return false;
    if (pendingInstall) {
      quitAfterPending = true;
      event.preventDefault();
      return true;
    }
    if (!downloaded) return false;
    event.preventDefault();
    void install({ isSilent: true, isForceRunAfter: false, onQuit: true });
    return true;
  }

  return {
    recordDownloaded,
    install,
    handleBeforeQuit,
    isRechecking: () => recheckDepth > 0,
    hasDownloaded: () => downloaded !== null,
    getDownloaded: () => downloaded,
  };
}

module.exports = {
  UPDATER_POLICY,
  RECHECK_TIMEOUT_MS,
  configureUpdater,
  extractDownloadedInfo,
  matchesOfferedUpdate,
  discardDownloadedUpdate,
  createUpdaterGuard,
};
