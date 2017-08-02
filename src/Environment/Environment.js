export const getDetails = (element) => {
  return {
    elementWidth: element.clientWidth,
    elementHeight: element.clientHeight,
    viewportWidth: Math.max(document.body.clientWidth, window.innerWidth),
    viewportHeight: Math.max(document.body.clientHeight, window.innerHeight),
    focus: isInFocus(),
    iframeContext: iFrameContext()
  }
}

export const isInFocus = () => {
    if (document.hidden !== 'undefined'){
        if (document.hidden === true){
            return false;
        }
    }

    if(iFrameContext() === servingScenarios.CROSS_DOMAIN_IFRAME) {
        return true;
    }

    if(window.document.hasFocus) {
        return window.top.document.hasFocus();
    }

    return true;
}

export const iFrameContext = () => {
    try {
        if(window.top === window) {
            return servingScenarios.ON_PAGE
        }

        let curWin = window, level = 0;
        while(curWin.parent !== curWin && level < 1000) {
            if(curWin.parent.document.domain !== curWin.document.domain) {
                return servingScenarios.CROSS_DOMAIN_IFRAME;
            }

            curWin = curWin.parent;
        }
        servingScenarios.SAME_DOMAIN_IFRAME;
    }
    catch(e) {
        return servingScenarios.CROSS_DOMAIN_IFRAME
    }
}

export const servingScenarios = {
    return {
        ON_PAGE: 'on page',
        SAME_DOMAIN_IFRAME: 'same domain iframe',
        CROSS_DOMAIN_IFRAME: 'cross domain iframe'
    }
}