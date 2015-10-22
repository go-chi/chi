chi
===

`chi` is an expressive, lightweight and fast HTTP mux/router for Go web services built on net/context.
Chi is everything you need to build services from composable http handlers.

![alt tag](https://imgry.pressly.com/x/fetch?url=deeporigins-deeporiginsllc.netdna-ssl.com/wp-content/uploads/sites/4/2015/09/Tai_Chi2.jpg&size=800x)

## Features

* Lightweight
* Fast (yes, benchmarks coming)
* Expressive routing: middleware stacks, inline middleware, groups, sub routes,
* Request context control (value chaining, deadlines and timeouts) - built on `net/context`
* Robust (tested, used in production)

## Example

--todo--

see: _examples/simple

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
* HTTP2 example..? -- single router/server, support
   both http 1.1 and http2 automatically.. just turn it on :)
* Websocket example


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
