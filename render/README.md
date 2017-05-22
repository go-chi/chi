# chi/render

The `render` sub-package helps manage HTTP request / response payloads.

Every well-designed, robust and maintainable Web Service / REST API also needs
well-*defined* request and response payloads. Together with the endpoint handlers,
the request and response payloads make up the contract between your server and the
clients calling on it.

Typically in a REST API application, you will have your data models (objects/structs)
that hold lower-level runtime application state, and at times you need to assemble,
decorate, hide or transform the representation before responding to a client. That
server output (response payload) structure, is also likely the input structure to
another handler on the server.

This is where `render` comes in - offering a few simple helpers and interfaces to
provide a simple pattern for managing payload encoding and decoding.

We've also combined it with some helpers for responding to content types and parsing
request bodies. Please have a look at the [rest](https://github.com/pressly/chi/blob/master/_examples/rest/main.go)
example which uses the latest chi/render sub-pkg.

All feedback is welcome, thank you!

