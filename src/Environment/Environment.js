export const getDetails = (element) => {
  return {
    elementWidth: element.clientWidth,
    elementHeight: element.clientHeight,
    viewportWidth: Math.max(document.body.clientWidth, window.innerWidth),
    viewportHeight: Math.max(document.body.clientHeight, window.innerHeight),
    focus:  
  }
}

export const isInFocus = () => {
  if()
}

export const 


this.servingScenarioEnum = { OnPage: 1, SameDomainIframe: 2, CrossDomainIframe: 3 };


 function getServingScenarioType(servingScenarioEnum) {
        try {
      if (window.top == window) {
        return servingScenarioEnum.OnPage;
      }
      var curWin=window;  
      var level=0;      
      while(curWin.parent != curWin  && level<1000){
         if (curWin.parent.document.domain != curWin.document.domain) {
          return servingScenarioEnum.CrossDomainIframe;
         }
         curWin = curWin.parent;
      }
      return servingScenarioEnum.SameDomainIframe;
        } catch (e) { }
        return servingScenarioEnum.CrossDomainIframe;
    };
  
    this.servingScenario = getServingScenarioType(this.servingScenarioEnum);
    this.IN_IFRAME = (this.servingScenario != this.servingScenarioEnum.OnPage);
    this.IN_XD_IFRAME =  (this.servingScenario == this.servingScenarioEnum.CrossDomainIframe);
    this.geometrySupported = !this.IN_XD_IFRAME;


 var  browser = getBrowserDetailsByUserAgent(userAgent);

    this.getBrowser = function()
    {
        return browser;
    }

    this.getBrowserIDEnum = function()
    {
        return browserIDEnum;
    }

 var isInFocus = function () {
        if (document.hidden !== 'undefined'){
            if (document.hidden === true){
                // Either the browser window is minified or the page is on an inactive tab.
                // Ad cannot be visible. No need to test document.hasFocus()
                return false;
            }
        }

        // Either we are on an unminified, active tab or 'document.hidden' is not supported).
        // Are we in the active window? ...
        if ($ovv.IN_XD_IFRAME) {
            // Active browser window cannot be determined, and document.hasFocus()
            // fails if player iframe does not have focus within its containing page
            // Give the benefit of the doubt.
            return true;
        }

        // We are in a same-domain iframe (or not in iframe at all)
        // Active browser window can be determined by widow.top.document.hasFocus():
        if (window.top.document.hasFocus) {
            return window.top.document.hasFocus();
        }

        //Cannot be determined : Give the benefit of the doubt.
        return true;
    };

    var browserIDEnum = {
        MSIE: 1,
        Firefox: 2,
        Chrome: 3,
        Opera: 4,
        safari: 5
    };



function getBrowserDetailsByUserAgent(ua, t) {

        var getData = function () {
            var data = { ID: 0, name: '', version: '' };
            var dataString = ua;
            for (var i = 0; i < dataBrowsers.length; i++) {
                // Fill Browser ID
                if (dataString.match(new RegExp(dataBrowsers[i].brRegex)) != null) {
                    data.ID = dataBrowsers[i].id;
                    data.name = dataBrowsers[i].name;
                    if (dataBrowsers[i].verRegex == null) {
                        break;
                    }
                    //Fill Browser Version
                    var brverRes = dataString.match(new RegExp(dataBrowsers[i].verRegex + '[0-9]*'));
                    if (brverRes != null) {
                        var replaceStr = brverRes[0].match(new RegExp(dataBrowsers[i].verRegex));
                        data.version = brverRes[0].replace(replaceStr[0], '');
                    }
                    var brOSRes = dataString.match(new RegExp(winOSRegex + '[0-9\\.]*'));
                    if (brOSRes != null) {
                        data.os = brOSRes[0];
                    }
                    break;
                }
            }
            return data;
        };

        var winOSRegex = '(Windows NT )';
        var dataBrowsers = [{
            id: 4,
            name: 'Opera',
            brRegex: 'OPR|Opera',
            verRegex: '(OPR\/|Version\/)'
        }, {
            id: 1,
            name: 'MSIE',
            brRegex: 'MSIE|Trident/7.*rv:11|rv:11.*Trident/7',
            verRegex: '(MSIE |rv:)'
        }, {
            id: 2,
            name: 'Firefox',
            brRegex: 'Firefox',
            verRegex: 'Firefox\/'
        }, {
            id: 3,
            name: 'Chrome',
            brRegex: 'Chrome',
            verRegex: 'Chrome\/'
        }, {
            id: 5,
            name: 'Safari',
            brRegex: 'Safari|(OS |OS X )[0-9].*AppleWebKit',
            verRegex: 'Version\/'
        }
        ];

        return getData();
    }

    this.getViewPortSize = function (contextWindow) {
        var viewPortSize = {
            width: Infinity,
            height: Infinity,
            area:Infinity
        };

        //document.body  - Handling case where viewport is represented by documentBody
        //.width
        if (!isNaN(contextWindow.document.body.clientWidth) && contextWindow.document.body.clientWidth > 0) {
            viewPortSize.width = contextWindow.document.body.clientWidth;
        }
        //.height
        if (!isNaN(contextWindow.document.body.clientHeight) && contextWindow.document.body.clientHeight > 0) {
            viewPortSize.height = contextWindow.document.body.clientHeight;
        }
        //document.documentElement - Handling case where viewport is represented by documentElement
        //.width
        if (!!contextWindow.document.documentElement && !!contextWindow.document.documentElement.clientWidth && !isNaN(contextWindow.document.documentElement.clientWidth)) {
            viewPortSize.width = contextWindow.document.documentElement.clientWidth;
        }
        //.height
        if (!!contextWindow.document.documentElement && !!contextWindow.document.documentElement.clientHeight && !isNaN(contextWindow.document.documentElement.clientHeight)) {
            viewPortSize.height = contextWindow.document.documentElement.clientHeight;
        }
        //window.innerWidth/Height - Handling case where viewport is represented by window.innerH/W
        //.innerWidth
        if (!!contextWindow.innerWidth && !isNaN(contextWindow.innerWidth)) {
            viewPortSize.width = Math.min(viewPortSize.width, contextWindow.innerWidth);
        }
        //.innerHeight
        if (!!contextWindow.innerHeight && !isNaN(contextWindow.innerHeight)) {
            viewPortSize.height = Math.min(viewPortSize.height, contextWindow.innerHeight);
        }
        viewPortSize.area = viewPortSize.height * viewPortSize.width;
        return viewPortSize;
    };