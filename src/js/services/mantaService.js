'use strict'

angular.module('canoeApp.services').service('mantaService', function ($log) {

  this.connect = function(url, callback) {
    var mqtt,
      sessionID,
      paymentRequest,
      port,
      host,
      connected,
      ppCert,
      ppPublicKey

    var APPIA_PEM = `-----BEGIN CERTIFICATE-----
MIIDaDCCAlCgAwIBAgIINZv0BbLXm9AwDQYJKoZIhvcNAQELBQAwOjELMAkGA1UE
BhMCVUsxDjAMBgNVBAoTBUFwcGlhMRswGQYDVQQDExJBcHBpYSBEZXZlbG9wZXIg
Q0EwHhcNMTgxMDE3MDc0MjAwWhcNMjgxMDE3MDc0MjAwWjA6MQswCQYDVQQGEwJV
SzEOMAwGA1UEChMFQXBwaWExGzAZBgNVBAMTEkFwcGlhIERldmVsb3BlciBDQTCC
ASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBALLV0rgr0TYjTKMLOPQlHNp9
V2NyfyTY6rZd3uLs6UWH4BZSAu2jlB40pWeIoFZb7+sBuJbGe4l1VKPgospynB/+
+qxDnMNjY2M41a4Gv2Mr261xfNKJ0Vwd1D7WK9XN+3p4BS2dEmv685dSk3AhbnhU
RVcIFy6aUYCVjLZeg3M0CGPaGy6Zb0g8kt5mQdAQtFTE0wZ0cSUPea9QT+5kDs38
Lc0jVo1QqB4DFpJ6ceg3sLSB2fGS6c4YEU8SKvu2rLk/VVJJstjFrAwvKQfx+oSx
NPotU37C4zPG3wBfWb2o/DjFUPWyq6sjtXUb6kmzfcsdP50vN0K8LTpBF84CsqUC
AwEAAaNyMHAwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4EFgQUOJcBmAyRITBHOIqC
s+sZ5eM0xlQwCwYDVR0PBAQDAgEGMBEGCWCGSAGG+EIBAQQEAwIABzAeBglghkgB
hvhCAQ0EERYPeGNhIGNlcnRpZmljYXRlMA0GCSqGSIb3DQEBCwUAA4IBAQCpudBY
QX4bm6La9cx7h4fruuBmC2NIF2GhobZzd1lEx5bEPtq5S6kx3Qr7pY0yoQtN+lpn
XWJJQcks3a4WhF0YeqesBcLdlXqMCDsFU6A4yJ6x25FaoelMpv+Keoj+sYuNtcyb
sfWjDvDaOU1jj76nLX+llMHAau0gALQrH39KCYkORwltOQgc98X/aX/UiBMBxSz8
dCU0MPLl8dU8KnprtG2Ibik86J649o4EJr0lA01liQicr/viKrVOqzS6cq18hJaX
zvYu2RVV+AtDHXXE462p3sT8Bk2iB979aDV3GsD0/WrRVwyPhi7YG6zM4otv59xF
O+dbxo9YqCeAzbna
-----END CERTIFICATE-----`
    var APPIA_CA = forge.pki.certificateFromPem(APPIA_PEM)
    var CA_STORE = forge.pki.createCaStore()
    CA_STORE.addCertificate(APPIA_CA)

    function isConnected() {
      return connected
    }

    function disconnect() {
      if (mqtt) {
        mqtt.disconnect()
      }
      connected = false
      mqtt = null
    }

    function onConnected(isReconnect) {
      $log.debug("connected")
      connected = true
      mqtt.subscribe("certificate")
    }

    function onFailure() {
      $log.error('MQTT failure')
      connected = false
    }

    function onConnectionLost(responseObject) {
      if (responseObject.errorCode !== 0) {
        $log.debug("Manta MQTT connection lost:", responseObject)
      }
      connected = false
    }

    function onCertificateReceived(payload) {
      // Make sure the payment processor certification was signed by the Appia CA so we can trust their message signatures
      $log.debug("Payment processor certificate received")
      try {
        var forgeTestCer = forge.pki.certificateFromPem(payload)
        try {
          if(forge.pki.verifyCertificateChain(CA_STORE, [forgeTestCer])) {
            $log.debug("Payment processor certificate is in CA chain")
            ppCert = forgeTestCer
            ppPublicKey = ppCert.publicKey
            mqtt.subscribe("payment_requests/" + sessionID)
            publish('payment_requests/' + sessionID + '/all', {}, 1, false)
          } else {
            $log.error("Payment processor certificate is invalid or does not belong to CA");
            callback(
              {
                error:"Payment processor certificate is invalid or does not belong to CA"
              }
            );
          }
        } catch(e) {
          $log.error("Error while verifying certificate chain.", payload, e)
          return false;
        }
      } catch(e) {
        $log.error("Error while parsing PEM to certificate", payload, e)
        return false;
      }
    }
    function connectFailure(c, code, msg) {
      $log.error('Failed connecting to MQTT: ' + JSON.stringify({context: c, code: code, msg: msg}))
      disconnect()
    }

    function connectSuccess() {
      $log.debug('Connected to MQTT broker.')
    }

    function parseURL(url) {
      var pattern = /manta:\/\/((?:\w|\.)+)(?::(\d+))?\/(.+)/
      return url.match(pattern)
    }

    function onMessageArrived(message) {
      $log.debug('Manta Topic: ' + message.destinationName + ' Payload: ' + message.payloadString)
      var topic = message.destinationName
      var payload = message.payloadString
      if (topic === 'certificate') {
        onCertificateReceived(payload)
      } else {
        var tokens = topic.split('/')
        switch (tokens[0]) {
          case 'payment_requests':
            $log.debug("Got Payment Request");
            var paymentRequest = JSON.parse(payload)
            var paymentRequestMessage = JSON.parse(paymentRequest.message)
            for (var i = 0; i < paymentRequestMessage.destinations.length; i++) {
              if (paymentRequestMessage.destinations[i].crypto_currency === "NANO") {
                if (verifySignature(paymentRequest.message,paymentRequest.signature)) {
                  $log.debug("Valid Signature");
                  var big = new BigNumber(paymentRequestMessage.destinations[i].amount);
                  var amount = (big.times(Math.pow(10, 30))).toFixed(0)
                  var paymentDetails = {
                    error: null,
                    account: paymentRequestMessage.destinations[i].destination_address,
                    amount: amount,
                    message: paymentRequestMessage,
                    merchant: paymentRequestMessage.merchant
                  }
                  $log.debug("Returning from MantaWallet");
                  $log.debug(paymentDetails)
                  callback(paymentDetails);
                } else {
                  $log.error("Invalid Signature");
                  callback(
                    {
                      error:"Invalid Signature"
                    }
                  );
                }
              }
            }
            break;
          default:
            $log.error("Unknown Case", tokens[0]);
        }
      }
    }

    function publishPayment(hash) {
      var payment = {
        crypto_currency: "nano",
        transaction_hash: hash,
      };
      mqtt.subscribe('acks/'+sessionID);
      publish('payments/'+sessionID, payment, 1, false);
    }

    function publish(topic, data, qos, retained) {
      let json = JSON.stringify(data)
      $log.debug("publishing", topic, json, qos, retained)
      if (mqtt) {
        var message = new Paho.MQTT.Message(json)
        message.destinationName = topic
        if (qos !== undefined) {
          message.qos = qos
        }
        if (retained !== undefined) {
          message.retained = retained
        }
        $log.debug('Send ' + topic + ' ' + json)
        mqtt.send(message)
      } else {
        $log.error('Not connected to MQTT, should send ' + topic + ' ' + json)
      }
    }

    function verifySignature(message, signature) {
      var md = forge.md.sha256.create();
      md.update(message, "utf8");
      var dsig = forge.util.decode64(signature);
      var result = false;
      try {
        result = ppPublicKey.verify(md.digest().bytes(), dsig);
      } catch (e) {
        $log.error("Error while verifying manta message signature", e, message, signature, dsig);
      }
      return result;
    }

    function init() {
      var results = parseURL(url)
      $log.debug(results)
      if (results.length < 2) return null;
      host = results[1]
      sessionID = results[results.length-1]
      port = results.length === 3 ? parseInt(results[1]) : 80 // TODO: Determine if this is the best default port or if we should default to MQTTWS standard 11883
      $log.debug("Initalizing a new MQTT Connection")
      mqtt = new Paho.MQTT.Client(host,port,"canoeNanoWallet")
      mqtt.onConnectionLost = onConnectionLost
      mqtt.onConnected = onConnected
      mqtt.onFailure = onFailure
      mqtt.onMessageArrived = onMessageArrived
      var opts = {
        reconnect: false,
        keepAliveInterval: 3600,
        onSuccess: connectSuccess,
        onFailure: connectFailure
      }
      mqtt.connect(opts)
    }

    init()

    return {
      isConnected: isConnected,
      disconnect: disconnect,
      publishPayment: publishPayment
    }
  }

})
