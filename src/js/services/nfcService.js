'use strict'
angular.module('canoeApp.services').factory('nfcService', function ($log, platformInfo, incomingData, popupService, gettextCatalog) {
  var root = {}

  var _isAvailable = false

  if (platformInfo.isCordova) {
    $log.debug("NFC: Platform is cordova")
    window.plugins.nfc = window.nfc || {}
    window.plugins.nfc.enabled(
      function () {
        $log.debug("NFC: Available")
        _isAvailable = true
        start();
      }, function(err) {
        $log.debug("NFC: Unavailable")
        $log.debug(err);
        _isAvailable = false;
      }
    )
  } else {
    $log.debug("NFC: Not cordova, no NFC available")
  };

  root.handleTag = function(nfcEvent) {
    $log.info("NFC: Tag received")
    $log.info("NFC: " + JSON.stringify(nfcEvent))
    $log.debug("NFC payload: " + String.fromCharCode(...(nfcEvent.tag.ndefMessage[0].payload)))
    incomingData.redir(String.fromCharCode(...(nfcEvent.tag.ndefMessage[0].payload)), null, function (err, code) {
      if (err) {
        $log.error("NFC: Data error: " + JSON.stringify(err));
        popupService.showAlert(
          gettextCatalog.getString('Error'),
          gettextCatalog.getString('Unrecognized data'), function () {
            // nada
          }
        )
      }
    })
  }

  function start() {
    if(_isAvailable) {
      window.plugins.nfc.addNdefListener(root.handleTag,
        function () {
          $log.debug("NFC: Listening")
        }, function(err) {
          // failed to listen
          $log.error("NFC: Failed to listen: " + JSON.stringify(err))
        })
    }
  }


  root.isAvailable = function () {
    return _isAvailable
  }

  return root
})
