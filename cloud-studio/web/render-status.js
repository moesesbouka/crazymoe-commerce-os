"use strict";
globalThis.studioRenderStatus = {
  watch({read,show,revision,active,schedule=setTimeout,cancel=clearTimeout}) {
    let stopped=false,timer;
    const messages={ready:"Listing photos are ready.",queued:"Preparing listing photos in the cloud…",running:"Preparing listing photos in the cloud…",
      failed:"Photo preparation failed. Your originals and saved edits are safe.",needs_photos:"This product has no selected listing photos.",
      selection_limit:"Automatic preparation supports up to 10 selected photos. All uploaded originals are saved.",
      not_prepared:"Listing photos have not been prepared yet."};
    async function tick(){
      if(stopped||!active())return;
      try {
        const value=await read();
        if(stopped||!active())return;
        if(value.revision!==revision){show("This product changed. Refresh before reviewing its draft.",false);return;}
        show(messages[value.state]||"Photo status unavailable.",value.state==='ready',value);
        if(['queued','running'].includes(value.state))timer=schedule(tick,5000);
      }catch(error){
        if(stopped||!active())return;
        show("Unable to check photo preparation. Reconnecting…",false);timer=schedule(tick,15000);
      }
    }
    tick();
    return ()=>{stopped=true;cancel(timer);};
  }
};
