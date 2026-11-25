"use strict";

window.StudioChannels = (() => {
  const auth = studioAuth.auth;
  const api = "https://sfheqjnxlkygjfohoybo.supabase.co";
  const publicKey = "sb_publishable_xfIVDlnktUiJYm5U_1jEtw_Res600Af";

  async function rpc(name, args = {}, signal) {
    const {data, error} = await auth.getSession();
    if (error || !data.session) throw Error("Sign in to Studio to continue.");
    const response = await fetch(api + "/rest/v1/rpc/" + name, {
      method: "POST",
      cache: "no-store",
      headers: {
        apikey: publicKey,
        Authorization: "Bearer " + data.session.access_token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(args),
      signal
    });
    const body = await response.json();
    if (!response.ok) throw Error(body.message || "Studio could not load this information.");
    return body;
  }

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  return {auth, rpc, element};
})();

(() => {
  const slot = document.querySelector("[data-facebook-import]");
  if (!slot) return;

  const {auth, rpc, element} = StudioChannels;
  const running = run => ["discovering", "saving"].includes(run?.state);
  const stateText = {
    discovering: "Finding Facebook listings",
    saving: "Saving listing observations",
    completed: "Scan complete",
    partial: "Partial scan",
    stopped: "Scan stopped",
    failed: "Scan failed",
    interrupted: "Scanner disconnected"
  };
  const endText = {
    end_of_feed: "Facebook confirmed the end of the listings feed.",
    verified_empty: "Facebook confirmed that this selling feed is empty.",
    page_cap: "The page limit was reached. The saved results cover only part of the catalog.",
    failed: "The scanner could not verify the listings feed."
  };
  const errorText = {
    FACEBOOK_HTTP: "Facebook returned an HTTP error.",
    FACEBOOK_NETWORK: "The connection to Facebook was interrupted.",
    FACEBOOK_TIMEOUT: "A Facebook listings page timed out.",
    FACEBOOK_RESPONSE: "Facebook returned an unreadable listings response.",
    FACEBOOK_CURSOR: "Facebook listing pagination could not continue.",
    FACEBOOK_IDENTITY: "The signed-in Facebook profile could not be verified.",
    STUDIO_ERROR: "Studio could not complete this scan."
  };
  const trigger = element("button", undefined, "cm-import-trigger");
  trigger.type = "button";
  trigger.hidden = true;
  trigger.setAttribute("aria-haspopup", "dialog");
  const spinner = element("span", undefined, "cm-import-spinner");
  spinner.setAttribute("aria-hidden", "true");
  const triggerText = element("span", "Facebook imports");
  trigger.append(spinner, triggerText);
  slot.append(trigger);

  const dialog = element("dialog", undefined, "cm-import-dialog");
  dialog.setAttribute("aria-labelledby", "cm-import-title");
  dialog.innerHTML = `
    <div class="import-head"><h2 id="cm-import-title">Facebook imports</h2><time data-elapsed></time></div>
    <div class="import-body">
      <label data-choose hidden>Scan <select data-run></select></label>
      <div data-details hidden>
        <p data-state role="status"></p>
        <ol class="import-steps">
          <li data-discover></li>
          <li data-save></li>
        </ol>
        <progress data-progress aria-label="Listing observations saved" hidden></progress>
        <dl class="import-counts">
          <div><dt>Found</dt><dd data-count="found"></dd></div>
          <div><dt>Refreshed</dt><dd data-count="refreshed"></dd></div>
          <div><dt>New for review</dt><dd data-count="pending"></dd></div>
          <div><dt>Skipped</dt><dd data-count="skipped"></dd></div>
        </dl>
      </div>
      <p class="import-note" data-note></p>
      <p class="import-note" data-error role="status" hidden></p>
      <a href="https://www.facebook.com/marketplace/you/selling" target="_blank" rel="noopener noreferrer" data-open>Open Facebook selling</a>
    </div>
    <form method="dialog" class="import-footer">
      <button type="button" class="import-stop" data-stop hidden>Stop scan</button>
      <button>Close</button>
    </form>`;
  document.body.append(dialog);

  const find = key => dialog.querySelector("[data-" + key + "]");
  let runs = [], selectedId = "", timer, epoch = 0, statusError = "", stopPending = false;
  const current = () => runs.find(run => run.id === selectedId) || runs.find(running) || runs[0];

  function elapsed() {
    const run = current();
    let value = "";
    if (run) {
      const seconds = Math.max(0, Math.floor(((run.finished_at ? Date.parse(run.finished_at) : Date.now()) - Date.parse(run.started_at)) / 1000));
      if (Number.isFinite(seconds)) value = seconds < 60 ? seconds + "s" : Math.floor(seconds / 60) + "m " + seconds % 60 + "s";
    }
    find("elapsed").textContent = value;
  }

  function render() {
    const active = runs.find(running);
    const run = current();
    spinner.hidden = !active;
    triggerText.textContent = active ? "Importing Facebook" + (runs.filter(running).length > 1 ? " (" + runs.filter(running).length + ")" : "") : "Facebook imports";
    find("choose").hidden = runs.length < 2;
    find("details").hidden = !run;
    find("stop").hidden = !running(run);
    find("stop").disabled = stopPending;
    find("open").hidden = !!active;
    find("error").hidden = !statusError;
    find("error").textContent = statusError;
    if (!run) {
      find("note").textContent = "Start a scan from the Crazy Moe extension on your Facebook selling page. Its progress will appear here.";
      elapsed();
      return;
    }

    const options = find("run");
    options.replaceChildren(...runs.map(item => new Option(
      item.account_tag + " · " + (stateText[item.state] || item.state) + " · " + new Date(item.started_at).toLocaleString(), item.id
    )));
    options.value = run.id;
    const stateLabel = [
      run.account_tag, stateText[run.state] || run.state,
      run.pages ? run.pages + (run.pages === 1 ? " page" : " pages") : "",
      run.scanner_version ? "Scanner " + run.scanner_version : ""
    ].filter(Boolean).join(" · ");
    if (find("state").textContent !== stateLabel) find("state").textContent = stateLabel;
    const discoveryFinished = !!run.saving_at;
    find("discover").textContent = discoveryFinished ? "Listings found" : running(run) ? "Finding listings…" : "Listing discovery ended";
    find("save").textContent = run.state === "completed" ? "Observations saved" : run.state === "saving" ? "Saving observations…" : running(run) ? "Waiting to save observations" : "Saved " + run.processed + " of " + run.found + " observations";
    const progress = find("progress");
    progress.hidden = !run.saving_at || !run.found;
    progress.max = Math.max(1, run.found);
    progress.value = run.processed;
    for (const count of dialog.querySelectorAll("[data-count]")) count.textContent = Number(run[count.dataset.count]).toLocaleString();
    find("note").textContent = running(run)
      ? "You can close this window or leave Studio. Keep the Facebook selling tab open while the scan runs."
      : errorText[run.error_code] || endText[run.end_reason] ||
        (run.state === "partial" ? "This run has no verified completion record." :
          "Refreshed listings keep your saved edits. New observations are held for review.");
    elapsed();
  }

  async function refresh() {
    clearTimeout(timer);
    const request = ++epoch;
    const {data} = await auth.getSession();
    if (request !== epoch) return;
    trigger.hidden = !data.session;
    if (!data.session) {
      runs = [];
      if (dialog.open) dialog.close();
      return;
    }

    try {
      const result = await rpc("studio_facebook_import_status");
      if (request !== epoch) return;
      runs = result;
      statusError = "";
    } catch {
      if (request !== epoch) return;
      statusError = "Live import status is unavailable. Studio will retry.";
    }
    render();
    timer = setTimeout(refresh, dialog.open || runs.some(running) ? 4000 : 12000);
  }

  trigger.onclick = () => {
    selectedId = "";
    render();
    dialog.showModal();
    refresh();
  };
  find("run").onchange = event => { selectedId = event.target.value; render(); };
  find("stop").onclick = async () => {
    const run = current();
    if (!running(run) || stopPending) return;
    stopPending = true;
    render();
    try {
      const updated = await rpc("studio_facebook_import", {p_action: "stop", p_id: run.id});
      runs = runs.map(item => item.id === updated.id ? updated : item);
      await refresh();
    } catch {
      statusError = "Studio could not stop the scan. Try again.";
    } finally {
      stopPending = false;
      render();
    }
  };
  setInterval(() => { if (dialog.open) elapsed(); }, 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  auth.onAuthStateChange(event => {
    if (["SIGNED_IN", "SIGNED_OUT", "INITIAL_SESSION"].includes(event)) setTimeout(refresh, 0);
  });
  auth.initialize().then(refresh);
})();
