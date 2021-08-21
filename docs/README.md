# Chi

## 👋 Hi, Let's Get You Started With Chi

<!-- # Chi -->

`chi` is a lightweight, idiomatic and composable router for building Go HTTP services. It's
especially good at helping you write large REST API services that are kept maintainable as your
project grows and changes. `chi` is built on the new `context` package introduced in Go 1.7 to
handle signaling, cancelation and request-scoped values across a handler chain.

The focus of the project has been to seek out an elegant and comfortable design for writing
REST API servers, written during the development of the Pressly API service that powers our
public API service, which in turn powers all of our client-side applications.

The key considerations of chi's design are: project structure, maintainability, standard http
handlers (stdlib-only), developer productivity, and deconstructing a large system into many small
parts. The core router `github.com/go-chi/chi` is quite small (less than 1000 LOC), but we've also
included some useful/optional subpackages: [middleware](https://github.com/go-chi/chi/tree/master/middleware), [render](https://github.com/go-chi/render)
and [docgen](https://github.com/go-chi/docgen). We hope you enjoy it too!

## Features

* **Lightweight** - cloc'd in ~1000 LOC for the chi router
* **Fast** - yes, see [benchmarks](https://github.com/go-chi/chi#benchmarks)
* **100% compatible with net/http** - use any http or middleware pkg in the ecosystem that is also compatible with `net/http`
* **Designed for modular/composable APIs** - middlewares, inline middlewares, route groups and sub-router mounting
* **Context control** - built on new `context` package, providing value chaining, cancellations and timeouts
* **Robust** - in production at Pressly, CloudFlare, Heroku, 99Designs, and many others (see [discussion](https://github.com/go-chi/chi/issues/91))
* **Doc generation** - `docgen` auto-generates routing documentation from your source to JSON or Markdown
* **Go.mod support** - as of v5, go.mod support (see [CHANGELOG](https://github.com/go-chi/chi/blob/master/CHANGELOG.md))
* **No external dependencies** - plain ol' Go stdlib + net/http



## Examples

See [examples](https://github.com/go-chi/chi/blob/master/_examples/) for a variety of examples.



## Credits

* Carl Jackson for https://github.com/zenazn/goji
  * Parts of chi's thinking comes from goji, and chi's middleware package
    sources from goji.
* Armon Dadgar for https://github.com/armon/go-radix
* Contributions: [@VojtechVitek](https://github.com/VojtechVitek)

We'll be more than happy to see [your contributions](./CONTRIBUTING.md)!


## Beyond REST

chi is just a http router that lets you decompose request handling into many smaller layers.
Many companies use chi to write REST services for their public APIs. But, REST is just a convention
for managing state via HTTP, and there's a lot of other pieces required to write a complete client-server
system or network of microservices.

Looking beyond REST, I also recommend some newer works in the field:
* [webrpc](https://github.com/webrpc/webrpc) - Web-focused RPC client+server framework with code-gen
* [gRPC](https://github.com/grpc/grpc-go) - Google's RPC framework via protobufs
* [graphql](https://github.com/99designs/gqlgen) - Declarative query language
* [NATS](https://nats.io) - lightweight pub-sub


## License

Copyright (c) 2015-present [Peter Kieltyka](https://github.com/pkieltyka)

Licensed under [MIT License](./LICENSE)

[GoDoc]: https://pkg.go.dev/github.com/go-chi/chi?tab=versions
[GoDoc Widget]: https://godoc.org/github.com/go-chi/chi?status.svg
[Travis]: https://travis-ci.org/go-chi/chi
[Travis Widget]: https://travis-ci.org/go-chi/chi.svg?branch=master
