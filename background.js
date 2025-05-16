// Note: see https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background#browser_support on why we need both scripts/service_worker in manifest.

// Links to keeping script alive:
//
// https://bugzilla.mozilla.org/show_bug.cgi?id=1771203#c1
// https://discourse.mozilla.org/t/how-to-stop-a-background-script-from-going-idle-in-mv3/128327
// https://stackoverflow.com/questions/66618136/persistent-service-worker-in-chrome-extension
// https://discourse.mozilla.org/t/impossible-to-upgrade-to-manifest-v3-for-extensions-that-require-constant-persistent-listeners/125942/17
//

// A backend is a given search service. Multiple pages of the same service
// opened are still a single backend. For a backend, we maintain single active
// connection as long as it is available.
//
// We don't maintain a list of non-active connections for fallback purposes.
// We could, but would complicate for no extreme benefit. If the active page
// is closed, opening a new one will become the active (already open pages
// won't take over being active, for consistency's sake from the user's point
// of view).
//
backends = {};

// Set up keepalives. Manifest V3 doesn't have permanent background script or
// service worker, so they are terminated in lack of activity. Which is not
// a problem normally, since an incoming callback would start up the script,
// but there are some caveats:
//
// - Local state is lost (like globals). Not a tragedy, could use storage API's
//   session.
//
// - (Firefox 136?): contextMenu click callback doesn't seem to activate the
//    background script, so context menu clicks have no effect after a while.
//

// FF keepalive
// See https://bugzilla.mozilla.org/show_bug.cgi?id=1771203#c1
chrome.storage.onChanged.addListener((storage) => {});
function keepAliveFF() {
  console.log("keepAliveFF");
	chrome.storage.local.set({keepAlive: true});
	setTimeout(() => keepAliveFF(), 15000);
}
keepAliveFF();


chrome.runtime.onInstalled.addListener(function() {
  console.log("Extension installed");
});

chrome.contextMenus.create({
  title: "Search! with Juremy",
  contexts: ['selection'],
  id: 'searchSelection',
});

chrome.contextMenus.onClicked.addListener((info) => {
  console.log('menu listener', info);
  if (info.menuItemId == 'searchSelection') {
    handleFrontendEvent('contextMenu', {
      frontendEvent: {
        event: 'selectMonolingualText',
        selectedText: info.selectionText,
      },
    });
  } else {
    console.log("unknown menu item", info.menuItemId, info);
  }
});

// TODO(options): to storage & options page
const searchOptions = {
  // Valid: 'source', 'sourceIfEmpty', 'target', 'off'
  targetClickSearchMode: 'sourceIfEmpty',
  targetSelectSearchEnabled: true,
};

function handleFrontendEvent(feName, msg0) {
  // We'll leave the original intact, and rather make a copy with our
  // local modifications, if any.
  var msg = msg0;
  // Preprocess, taking into account options (if any)
  let feEv = msg.frontendEvent;
  if (feEv.event == 'clickSegment') {
    let activeSeg = feEv.segmentPair.active;
    if (activeSeg.location == 'target') {
      if (searchOptions.targetClickSearchMode == 'off') {
        return
      }
      const emptyTarget = !activeSeg.text.trim();
      if (searchOptions.targetClickSearchMode == 'sourceIfEmpty' && !emptyTarget) {
        return;
      }
      if (searchOptions.targetClickSearchMode == 'source'
          || searchOptions.targetClickSearchMode == 'sourceIfEmpty') {
        // Force a source-search.
        msg = {
          frontendEvent: {
            ...feEv,
            segmentPair: {
              active: feEv.segmentPair.other,
              other: activeSeg,
            },
          },
        };
      }
    }
  } else if (feEv.event == 'selectSegmentText') {
    if (feEv.segmentPair.active.location == 'target' && !searchOptions.targetSelectSearchEnabled) {
      return;
    }
  }
  // Enrich
  let extendedMsg = {
    ...msg,
    frontend: {
      name: feName,
    },
  };

  // Send to backends
  console.log('frontend event', feName, extendedMsg);
  for (var bn in backends) {
    console.log('sending to backend', bn);
    // TODO(comms): handle disconnected port
    backends[bn].port.postMessage(extendedMsg);
  }
}

chrome.runtime.onConnect.addListener(function(port) {
  let senderTabId = port.sender?.tab?.id;
  console.log(senderTabId);
  if (port.name == "frontend") {
    console.log("listening on new frontend port", port);
    var feName = "<unknown>";
    port.onMessage.addListener(function(msg) {
      if (msg.frontendInit) {
          let fi = msg.frontendInit;
          if (fi.frontendName) {
            feName = fi.frontendName;
          }
        console.log("frontend inited", fi, feName);
      }
      if (msg.frontendEvent) {
        handleFrontendEvent(feName, msg);
      }
    });
  } else if (port.name == "backend") {
    console.log("incoming backend port", port);
    port.onMessage.addListener(function(msg) {
      if (msg.backendInit) {
        let bi = msg.backendInit;
        let bn = bi.backendName;
        if (bn == null) return;
        // Note: in Firefox at least, it is not guaranteed that we get the
        // disconnect call on a page reload (due to search).
        port.onDisconnect.addListener(function() {
          console.log("backend disconnected", bn);
          delete backends[bn];
        });
        if (bn in backends && senderTabId == backends[bn].tabId) {
          // Getting new init from same tab (and backend) means the old
          // instance is gone (and we didn't get the disconnect).
          console.log("backend tab reloaded, disconnecting", bn);
          try {
            backends[bn].port.disconnect();
          } catch (err) {
            console.log("backend had some error in forced disconnect, ignoring", err);
          }
          delete backends[bn];
        }
        if (bn in backends) {
          console.log("backend requesting init has existing port already, ignoring and using existing");
          try {
            port.disconnect();
          } catch (err) {
            console.log("ignored backend was not happy about disconnect", err);
          }
        } else {
          console.log("registering new backend (with tab)", bn, senderTabId);
          backends[bn] = {
            port: port,
            tabId: senderTabId,
          };
        }
      }
    });
  }
});
