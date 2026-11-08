# Studio session recovery — 68.1.26

The approved panel previously stored credentials only in Chrome session memory, had no way to reacquire them after an extension/browser restart, and rejected access tokens more than two minutes past expiry before attempting refresh. Its empty picker could therefore appear even while Studio held approved listings.

The updated worker reconnects through a content script restricted to the two Studio origins. The Studio page uses its existing authentication SDK session. No browser-profile files are read and no credential is persisted to disk. Requests and refresh-token rotation share one in-flight operation. An older Studio editor remains untouched; if it cannot answer the new bridge, a fresh Studio tab loads current code. Signed-out and temporary-server failures remain explicit.

The approved panel retries when the seller returns from Studio and shows a connection placeholder instead of an empty picker. Product selection, approval revision checks, verified photos, and manual publishing remain in the existing approved-picker workflow.

Validation: eight worker/approved-queue regressions; existing member-session regression; isolated Chromium tests for the same-origin bridge, rejected cross-origin requests, and a ten-product picker at 390 and 1366 pixels. No real Facebook posting or confirmation is performed by these tests.

Installed on DESKTOP-NGK53N6 at the existing Gallery Recovery extension path. Four files verified; the previous three files are backed up in `pre-reconnect-68.1.26`. Chrome must reload the unpacked extension before this version runs. The Studio page bridge is deployed; actual Facebook-tab loading remains to be verified after that reload.
