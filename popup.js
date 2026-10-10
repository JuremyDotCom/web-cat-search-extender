(function() {
  const bl = browser.storage.local;

  async function loadModel() {
    const read = await bl.get("model");
    const defaultModel = {
      frontends: {
        memsource: {
          enabled: true,
        },
        memoq: {
          enabled: true,
        },
        matecat: {
          enabled: true,
        },
      },
      backends: {
        eurlex: {
          enabled: true,
        },
        iate: {
          enabled: true,
        },
        juremy: {
          enabled: true,
        },
      },
    }
    return {...defaultModel, ...read.model};
  }

  async function saveModel(model) {
    await bl.set({model: model});
  }

  async function startPopup() {
    console.log('start popup');
    const model = await loadModel();
    console.log('got', model);

    for (fe of ["memsource", "matecat", "memoq"]) {
      document.querySelector('input#fe_' + fe).checked = model.frontends[fe].enabled;
    }
    for (be of ["eurlex", "iate", "juremy"]) {
      document.querySelector('input#be_' + be).checked = model.backends[be].enabled;
    }

    document.querySelector('button#save').addEventListener('click', () => {
      console.log('save');
      for (fe of ["memsource", "matecat", "memoq"]) {
        model.frontends[fe].enabled = document.querySelector('input#fe_' + fe).checked;
      }
      for (be of ["eurlex", "iate", "juremy"]) {
        model.backends[be].enabled = document.querySelector('input#be_' + be).checked;
      }
      saveModel(model);
      window.close();
    });
  }

  if (document.readyState == 'complete') {
    console.log('popup ready');
    startPopup();
  } else {
    window.addEventListener('load', (ev) => {
      console.log('popup ready after load');
      startPopup();
    });
  }
})();
