chi
===

`chi` is an expressive, small and fast HTTP mux/router for Go web services built on net/context.

Chi encourages writing services by composing small handlers and middlewares with many or few routes.
Each middleware is like a layer of an onion connected through a consistent interface (http.Handler or
chi.Handler) and a context.Context argument that flows down the layers during a request's lifecycle.

In order to get the most out of this pattern, chi's routing methods (Get, Post, Handle, Mount, etc.)
support inline middlewares, middleware groups, and mounting (/composing) any chi router to another
(a bushel of onions). We've designed the Pressly API (150+ routes/handlers) exactly like this and its
scaled very well.

![alt tag](https://imgry.pressly.com/x/fetch?url=deeporigins-deeporiginsllc.netdna-ssl.com/wp-content/uploads/sites/4/2015/09/Tai_Chi2.jpg&size=800x)


## Features

* Lightweight - cloc`d in 573 LOC for the chi router
* Fast - yes, benchmarks coming
* Expressive routing - middleware stacks, inline middleware, groups, mount routers
* Request context control (value chaining, deadlines and timeouts) - built on `net/context`
* Robust (tested, used in production)

## Example

--todo--

see: _examples/simple


## net/context?

...


## Router design

.. radix, url params.. param, wildcard, regexp todo


Designed for the future. We're hopefully that by Go 1.7 (in 2016), `net/context` will be in the Go stdlib
and net/http will support context.Context natively, at which point we'll be updating the signatures to
embrace the future stdlib. And... then, we have infinitely more middlewares to compose from the community!!

.. chi.Handler

.. comment about interface{} types for the router methods, and lack of static type checking,
however this will be resolved sometime in the future when/if Go supports context.Context
natively in net/http.


## Middlewares

...


## Credits

* Carl Jackson for https://github.com/zenazn/goji
  * Parts of chi's thinking comes from goji, and Chi's middleware package
    sources from goji.
* Armon Dadgar for https://github.com/armon/go-radix
* Pressly team for inspiration


## TODO

* Mux options
  * Trailing slash
  * Case insensitive paths
  * GET for HEAD requests (auto fallback)
  * ...
* Register not found handler
* Register error handler (500's)
* Request timeout middleware
* Make note about separate responder
* HTTP2 example
  * both http 1.1 and http2 automatically.. just turn it on :)
* Websocket example
* Regexp support in router "/:id([0-9]+)" or "#id^[0-9]+$" or ..


## License

Copyright (c) 2015 Peter Kieltyka (https://twitter.com/peterk)

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
