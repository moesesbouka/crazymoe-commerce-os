"use strict";
document.querySelector("form").onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget, status = document.querySelector("[role=status]");
  form.querySelector("button").disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({type:"STUDIO_SYNC_LOGIN",
      email:form.elements.email.value,password:form.elements.password.value});
    if (!response?.ok) throw Error(response?.error || "Could not connect.");
    form.hidden = true;
    status.textContent = "Connected. Return to the Facebook selling tab and retry the import.";
  } catch(error) { status.textContent = error.message; }
  finally { form.elements.password.value = ""; form.querySelector("button").disabled = false; }
};
