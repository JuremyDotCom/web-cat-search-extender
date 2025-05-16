/* Development ideas

Common attributes:
  - project id / file id / client id - any that exists. For client-side mapping of options, or at least establishing of some source id. Example: hash them and send along with search, so backend can maintain search options even when context-switching.
  - some kind of row id (row number? or other opaque enumerable value)
  - current visible row range (for eventual contextful operations)
  - insert-to-target? Modifying data might be flaky.

QA mode (send both-side text in events).

**/

(function() {
  const debug = false;

  const util = {
    // Note: el can be a synthetic element like that of
    // Range's extractContents().
    visibleTextContent(el) {
      if (el.nodeType === Node.TEXT_NODE) {
        return el.textContent;
      }

      // TODO(content): this is somewhat memoQweb-specific. Make passable?
      if (el.nodeName == "FIGURE") {
        if (el.getAttribute("tag-name") == "br") {
          return " ";
        }
        if (el.getAttribute("tag-display-text") == "nbsp") {
          return "\xa0";
        }
        // TODO(text-handling): any other special figures?
      }

      if (el.getAttribute) {
        if (el.getAttribute("aria-hidden") == "true") {
          console.log("warning, encountered aria-hidden text");
          return "";
        }
      }

      var text = "";
      for (const child of el.childNodes) {
        text += util.visibleTextContent(child);
      }

      return text;
    },
    selectionRange() {
      let sel = document.getSelection();
      // "Caret" doesn't interest us.
      if (sel.type == "Range" && sel.rangeCount == 1) {
        return sel.getRangeAt(0);
      }
    }
  };

  const extUtil = {
    initAsBackend(name) {
      document.body.style.borderTop = "1px solid green";

      var port = chrome.runtime.connect({
        name: "backend"
      });
      port.onDisconnect.addListener(function() {
        console.log("disconnected");
        document.body.style.borderTop = "1px solid red";
      });

      port.postMessage({
        backendInit: {
          backendName: name,
        }
      });
      return port;
    },

    initAsFrontend(name) {
      let port = chrome.runtime.connect({
        name: "frontend"
      });
      port.postMessage({
        frontendInit: {
          frontendName: name
        }
      });

      document.body.style.borderTop = "1px solid green";

      return port;
    },
  };

  const memoQ = {
    findSegment(el) {
      while (el != null && !el.dataset?.segmentType) {
        el = el.parentElement;
      }
      return el;
    },
    segmentInfo(el) {
      let isSource = el.dataset.segmentType == "source";
      let langCode = el.attributes.lang.value;
      var c = el.querySelector('.ProseMirror');
      let text = c == null ? "" : util.visibleTextContent(c);
      return {isSource, langCode, text};
    },
    toCommonSegmentInfo(seg) {
      return {
        text: seg.text,
        langCode: seg.langCode,
        location: seg.isSource ? 'source' : 'target',
      };
    },
    findSiblingSegment(el) {
      let thisSegmentType = el.dataset.segmentType;
      while (el != null && !el.classList.contains("translation-row")) {
        el = el.parentElement;
      }
      if (el == null) return;
      let otherSegmentType  = thisSegmentType == "source" ? "target" : "source";

      return el.querySelector('div[data-segment-type="' + otherSegmentType + '"]');
    },
    // One-stop-shop to get full row info from a segment and its sibling.
    findSegmentAllInOne(el) {
      let seg = memoQ.findSegment(el);
      if (seg == null) return null;
      let sib = memoQ.findSiblingSegment(seg);
      if (sib == null) return null;
      let segInf = memoQ.segmentInfo(seg);
      let sibInf = memoQ.segmentInfo(sib);
      // Derived
      let rowSeg = {
        el: seg,
        info: segInf,
      };
      let rowSib = {
        el: sib,
        info: sibInf,
      };
      let rowSrc = segInf.isSource ? rowSeg : rowSib;
      let rowTgt = segInf.isSource ? rowSib : rowSeg;
      return {
        seg: rowSeg,
        sib: rowSib,
        src: rowSrc,
        tgt: rowTgt,
      };
    }
  };

  function installMemoQ() {
    let port = extUtil.initAsFrontend("memoQweb");

    // Note: we don't register and react to 'selectionchange', since it causes
    // odd interactions when acting on the selections syncronously. Rather
    // perform selection checks post-click.
    //
    // document.addEventListener('selectionchange', ...)
    //
    // (Well, we could try this again, maybe it was some implementation bug.
    // But it works well this way too, so why the extra listener).
    //
    document.addEventListener('mouseup', (ev) => {
      let rg = util.selectionRange();
      if (rg) {
        if (debug) console.log('Selection range', rg);
        var row = memoQ.findSegmentAllInOne(rg.commonAncestorContainer);
        if (row == null) {
          if (debug) console.log('Non-segment selection');
          return;
        }
        if (debug) console.log('Row', row);
        let txt = util.visibleTextContent(rg.cloneContents());
        if (debug) console.log('Selection text', txt);

        port.postMessage({
          frontendEvent: {
            event: 'selectSegmentText',
            selectedText: txt,
            segmentPair: {
                active: memoQ.toCommonSegmentInfo(row.seg.info),
                other: memoQ.toCommonSegmentInfo(row.sib.info),
            },
          }
        });
      } else {
        let row = memoQ.findSegmentAllInOne(ev.target);
        if (row == null) return;

        if (debug) {
          console.log('vvvvvvvvv*******************');
          console.log('row', row);
          console.log('^^^^^^^^*******************');
        }

        port.postMessage({
          frontendEvent: {
            event: 'clickSegment',
            segmentPair: {
                active: memoQ.toCommonSegmentInfo(row.seg.info),
                other: memoQ.toCommonSegmentInfo(row.sib.info),
            },
          }
        });
      }
    });
  }

  // TODO(cleanup): many overlap with other frontends.
  const matecat = {
    findSegment(el) {
      // TODO(matecat,precision): for this to match we really need to click
      //   on the segment text itself, not the whitespace buffer surrounding
      //   the segment. Not a big problem, but could be improved.
      while (el != null && !/^segment-.*-(target|source)$/.test(el.id)) {
        el = el.parentElement;
      }
      return el;
    },
    segmentInfo(el) {
      let isSource = /source$/.test(el.id);
      let sectionId = el.id.replace(/-(source|target)$/, "");
      let sectionEl = document.querySelector("section#" + sectionId);
      var langCode = "xx";
      const lookForStart = isSource ? /^source-/ : /^target-/;
      for (k of sectionEl.classList) {
        if (lookForStart.test(k)) {
          langCode = k.replace(lookForStart, "");
        }
      }

      let text = util.visibleTextContent(el);  // TODO(matecat): special formatting?
      return {isSource, langCode, text};
    },
    toCommonSegmentInfo(seg) {
      return {
        text: seg.text,
        langCode: seg.langCode,
        location: seg.isSource ? 'source' : 'target',
      };
    },
    findSiblingSegment(el) {
      let isSource = /source$/.test(el.id);
      let otherId = isSource ? el.id.replace(/source$/, "target") : el.id.replace(/target$/, "source");
      
      console.log("looking for sibling", el.id, '['+otherId+']');
      let res = el.parentElement.querySelector('#' + otherId);
      console.log("got", res);
      return res;
    },
    // One-stop-shop to get full row info from a segment and its sibling.
    findSegmentAllInOne(el) {
      let seg = matecat.findSegment(el);
      if (seg == null) return null;
      let sib = matecat.findSiblingSegment(seg);
      if (sib == null) return null;
      let segInf = matecat.segmentInfo(seg);
      let sibInf = matecat.segmentInfo(sib);
      // Derived
      let rowSeg = {
        el: seg,
        info: segInf,
      };
      let rowSib = {
        el: sib,
        info: sibInf,
      };
      let rowSrc = segInf.isSource ? rowSeg : rowSib;
      let rowTgt = segInf.isSource ? rowSib : rowSeg;
      return {
        seg: rowSeg,
        sib: rowSib,
        src: rowSrc,
        tgt: rowTgt,
      };
    }
  };

  function installMatecat() {
    let port = extUtil.initAsFrontend("matecat");

    // Note: we don't register and react to 'selectionchange', since it causes
    // odd interactions when acting on the selections syncronously. Rather
    // perform selection checks post-click.
    //
    // document.addEventListener('selectionchange', ...)
    //
    document.addEventListener('mouseup', (ev) => {
      let rg = util.selectionRange();
      if (rg) {
        if (debug) console.log('Selection range', rg);
        var row = matecat.findSegmentAllInOne(rg.commonAncestorContainer);
        if (row == null) {
          if (debug) console.log('Non-segment selection');
          return;
        }
        if (debug) console.log('Row', row);
        let txt = util.visibleTextContent(rg.cloneContents());
        if (debug) console.log('Selection text', txt);

        port.postMessage({
          frontendEvent: {
            event: 'selectSegmentText',
            selectedText: txt,
            segmentPair: {
                active: matecat.toCommonSegmentInfo(row.seg.info),
                other: matecat.toCommonSegmentInfo(row.sib.info),
            },
          }
        });
      } else {
        let row = matecat.findSegmentAllInOne(ev.target);
        if (row == null) return;

        if (debug) {
          console.log('vvvvvvvvv*******************');
          console.log('row', row);
          console.log('^^^^^^^^*******************');
        }

        port.postMessage({
          frontendEvent: {
            event: 'clickSegment',
            segmentPair: {
                active: matecat.toCommonSegmentInfo(row.seg.info),
                other: matecat.toCommonSegmentInfo(row.sib.info),
            },
          }
        });
      }
    });
  }


  const iate = {
    triggerSearch(txt) {
      const crudeWords = txt.replace(/\s+/g, ' ').split(' ').length;
      if (crudeWords > 5) return;  // TODO(options): to option
      document.querySelector("input#searchQuery").value = txt;
      document.querySelector("input#searchQuery").dispatchEvent(
        new KeyboardEvent('keyup', {'key': 'Enter', 'code': 'Enter', 'charCode':13, 'keyCode':13,'which':13}));
    },
  };

  function installIate() {
    let port = extUtil.initAsBackend("IATE");

    port.onMessage.addListener(function(msg) {
      console.log("got msg from ext", msg);
      if (msg.frontendEvent) {
        let fe = msg.frontendEvent;
        if (fe.event == 'selectSegmentText') {
          // TODO(iate,languages): Can't really set without crude hacks
          //   without native support.
          iate.triggerSearch(fe.selectedText);
        } else if (fe.event == 'clickSegment') {
          // pass
        } else if (fe.event == 'selectMonolingualText') {
          iate.triggerSearch(fe.selectedText);
        } else {
          console.log('Unknown event to handle');
        }
      }
    });
  }

  const eurlex = {
    triggerSearch(txt) {
      // NOTE(eurlex,stopwords): when clicking through to a result doc on
      //   EUR-Lex, the hit words are highlighted by yellow. If stopwords were
      //   removed from the query, there would be less visual noise on the
      //   result page. Though this is something that EUR-Lex could perform
      //   on their side as well.
      //
      // TODO(eurlex,option): if the text should be quotation-wrapped for
      //   exact search or not. Or even this extension could try a quoted first
      //   and fall back to unquoted if no results - but that is somewhat hard
      //   to set up (given that EUR-Lex reloads with search results), also a
      //   thing that could be an EUR-Lex side automatic option.
      //
      const quote = true;
      if (quote) {
        txt = '"' + txt + '"';
      }
      document.querySelector("textarea#QuickSearchField").value = txt;
      document.querySelector("textarea#QuickSearchField").dispatchEvent(
        new KeyboardEvent('keyup', {'key': 'Enter', 'code': 'Enter', 'charCode':13, 'keyCode':13,'which':13}));
    },
  };

  function installEurlex() {
    let port = extUtil.initAsBackend("EURLex");

    port.onMessage.addListener(function(msg) {
      console.log("got msg from ext", msg);
      if (msg.frontendEvent) {
        let fe = msg.frontendEvent;
        if (fe.event == 'selectSegmentText') {
          // TODO(eurlex,languages): Doesn't provide way to switch search
          //   language directly on the UI, without reloading the page. Won't
          //   resort to reloading (or to searching using URL directly), as
          //   that would slow down search (and latter is out of scope).
          //   Maybe we could keep track of multiple open windows, registering
          //   some properties of them (like their search language), and then
          //   dispatch the search accordingly, as a middle-ground?
          //
          eurlex.triggerSearch(fe.selectedText);
        } else if (fe.event == 'clickSegment') {
          eurlex.triggerSearch(fe.segmentPair.active.text);
        } else if (fe.event == 'selectMonolingualText') {
          eurlex.triggerSearch(fe.selectedText);
        } else {
          console.log('Unknown event to handle');
        }
      }
    });
  }


  const juremy = {
    normLang(lng) {
      return lng.replace(/-.*$/, "");
    },
  };

  function installJuremy() {
    let port = extUtil.initAsBackend("Juremy");

    port.onMessage.addListener(function(msg) {
      console.log("got msg from ext", msg);
      if (msg.frontendEvent) {
        let fe = msg.frontendEvent;
        if (fe.event == 'selectSegmentText') {
          window.postMessage({
            command: 'searchSource',
            text: fe.selectedText,
            sourceLang: juremy.normLang(fe.segmentPair.active.langCode),
            targetLang: juremy.normLang(fe.segmentPair.other.langCode),
          });
        } else if (fe.event == 'clickSegment') {
          window.postMessage({
            command: 'searchSource',
            text: fe.segmentPair.active.text,
            sourceLang: juremy.normLang(fe.segmentPair.active.langCode),
            targetLang: juremy.normLang(fe.segmentPair.other.langCode),
          });
        } else if (fe.event == 'selectMonolingualText') {
          window.postMessage({
            command: 'searchSource',
            text: fe.selectedText,
            sourceLang: null,
            targetLang: null,
          });
        } else {
          console.log('Unknown event to handle');
        }
      }
    });

  }

  function installInitial() {
    document.body.style.borderTop = "1px solid yellow";
    console.log('init', window.location.href);
    // Frontends
    if (/.*\.memoq\.com\/[^\/]*\/editor\/projects\/[^\/]*\/docs\/.*/.test(window.location.href)) {
      installMemoQ();
    } else if (/.*www\.matecat\.com\/translate\/.*/.test(window.location.href)) {
      installMatecat();
    }
    // Backends
    else if (/rigo/.test(window.location.href) || /juremy\.com/.test(window.location.href)) {
      installJuremy();
    } else if (/.*iate.europa.eu\/.*/.test(window.location.href)) {
      installIate();
    } else if (/.*eur-lex.europa.eu\/.*/.test(window.location.href)) {
      installEurlex();
    }
  }

  document.body.style.borderTop = "1px solid purple";
  if (document.readyState == 'complete') {
    console.log('installing Juremy browser extension');
    installInitial();
  } else {
    window.addEventListener('load', (ev) => {
      console.log('after page load: installing Juremy browser extension');
      installInitial();
    });
  }
})();
