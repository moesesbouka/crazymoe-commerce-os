chrome.runtime.onMessageExternal.addListener((message, sender, reply) => {
  if (studioOrigins.has(sender.origin) && message?.type === "STUDIO_CHECK_HANDOFF") {
    reply({ready:true});
  }
  return false;
});
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type !== "STUDIO_NGK_FILL") return false;
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !sender.tab?.id ||
      !/^https:\/\/(www|m)\.facebook\.com\/marketplace\/create\/item\/?(?:[?#]|$)/.test(sender.url || "")) {
    reply({ok:false,error:"Open a Facebook item form from Studio."});
    return false;
  }
  (async () => {
    const draft = await studioCloudNext(sender.tab.id, "MOE_LOCAL_NEXT");
    if (draft?.source !== "studio") throw Error("Open a fresh approved draft from Studio.");
    const result = await chrome.scripting.executeScript({
      target:{tabId:sender.tab.id}, world:"ISOLATED", args:[draft.item, true], func:moeFillExplicitListing
    });
    return result[0]?.result || {ok:false,error:"Facebook could not verify this form."};
  })().then(reply).catch(error=>reply({ok:false,error:error.message}));
  return true;
});
