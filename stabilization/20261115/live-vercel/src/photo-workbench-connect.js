const portalMode = location.pathname === "/photo-workbench.html";
const addressKey = "crazymoe-photo-workbench-address";
let workerOrigin = "";

function privateOrigin(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" &&
        /^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/.test(url.hostname) &&
        !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash) {
      return url.origin;
    }
  } catch {}
  return "";
}

export function workbenchUrl(path) {
  return workerOrigin + path;
}

export function resumeStorageKey() {
  return workerOrigin ? "moeStudioResume:" + workerOrigin : "moeStudioResume";
}

export async function workbenchRequest(path, options = {}) {
  try {
    return await fetch(workbenchUrl(path), {
      ...options, cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
      signal: options.signal ?? AbortSignal.timeout(60_000),
      ...(workerOrigin && { credentials: "omit", targetAddressSpace: "local" }),
    });
  } catch (error) {
    if (!workerOrigin) throw error;
    throw new Error("Could not reach the photo workbench. Check Tailscale, the AI desktop, and Chrome’s local network permission, then retry.", { cause: error });
  }
}

function loadStudioAuth() {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/auth.js";
    script.onload = () => {
      if (window.studioAuth?.auth) resolve(window.studioAuth.auth);
      else reject(new Error("Studio sign-in is unavailable. Reload to try again."));
    };
    script.onerror = () => reject(new Error("Studio sign-in is unavailable. Reload to try again."));
    document.head.append(script);
  });
}

export async function connectWorkbench(onReady) {
  const connect = document.getElementById("connect");
  const content = document.getElementById("workbench-content");
  const rail = document.getElementById("rail");
  const showWorkbench = () => {
    connect.hidden = true;
    content.hidden = rail.hidden = false;
    onReady();
  };
  if (!portalMode) {
    showWorkbench();
    return;
  }

  const status = document.getElementById("connect-status");
  const form = document.getElementById("connect-form");
  const address = document.getElementById("workbench-address");
  const disconnect = document.getElementById("workbench-disconnect");
  let connected = false;
  let connecting = false;

  async function connectTo(value) {
    const origin = privateOrigin(value);
    if (connecting || connected) return;
    if (!origin) {
      status.textContent = "Enter the HTTPS address of your private Tailscale workbench.";
      return;
    }
    connecting = true;
    form.querySelector("button").disabled = true;
    workerOrigin = origin;
    status.textContent = "Connecting to your AI desktop…";
    try {
      const response = await workbenchRequest("/api/workbench");
      if (response.status === 403) throw new Error("Use the owner’s Tailscale connection to open this workbench.");
      if (!response.ok) throw new Error("The AI desktop is up, but the Studio workbench didn’t respond.");
      const info = await response.json();
      if (info.service !== "crazy-moe-photo-workbench" || info.version !== 1) {
        throw new Error("This address did not return a compatible Studio workbench.");
      }
      try { localStorage.setItem(addressKey, origin); } catch {}
      connected = true;
      showWorkbench();
    } catch (error) {
      workerOrigin = "";
      status.textContent = error.message;
    } finally {
      connecting = false;
      form.querySelector("button").disabled = false;
    }
  }

  try {
    const auth = await loadStudioAuth();
    const { data, error } = await auth.getUser();
    if (error || !data.user) {
      status.textContent = "Sign in to Listing Studio, then open Photo workbench again.";
      return;
    }
    auth.onAuthStateChange(event => {
      if (event === "SIGNED_OUT") location.replace("/");
    });
    status.textContent = "Connect to your AI desktop over Tailscale.";
    form.hidden = false;
    disconnect.hidden = false;
    form.addEventListener("submit", event => {
      event.preventDefault();
      void connectTo(address.value);
    });
    disconnect.addEventListener("click", () => {
      try { localStorage.removeItem(addressKey); } catch {}
      location.reload();
    });
    let saved = "";
    try { saved = privateOrigin(localStorage.getItem(addressKey)); } catch {}
    const setup = privateOrigin(new URLSearchParams(location.hash.slice(1)).get("desktop"));
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    address.value = saved || setup;
    if (saved) await connectTo(saved);
  } catch (error) {
    status.textContent = error.message;
  }
}
