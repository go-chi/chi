chi
===

<let's get a photo... waterfall.. :) ... something zen...>

# TODO

* Path cleanup
* Trailing slash
* Subrouter
* NotFound handler -- for 404's
* ErrorHandler -- for 500's, ie. hook up a diff error page..
* RequestTimeout stuff..?
* Params.. chi.URLParams(ctx) ...? or chi.Params(ctx) ..?
* Use GetForHead ...? (body?)



# NOTES

* make note about separate responder..
* HTTP2 example..? -- single router/server, support
   both http 1.1 and http2 automatically.. just turn it on :)
* Websocket example ..
    ... Upgrade...?

* Static-typing: we take http.Handler .. .etc..
    * can we upgrade this to ctxhttp.Handler ...?
    * provide chi.MW(std-mw) and chi.H(std-h) wrappers ..?
