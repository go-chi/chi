# chi/render

The `render` sub-package helps manage HTTP request / response payloads.

Every a well-designed, robust and maintainable Web Service / REST API also needs
well-*defined* request and response payloads. 

Typically in a REST API application, you will have your data models (objects/structs)
that hold lower-level runtime application state, and at times you need to assemble,
decorate, hide or transform the representation before responding to a client, and
also the client will likely provide the same structure as input from its requests.

This is where `render` comes in - offering a few simple helpers and interfaces to
provide a simple pattern for managing payload encoding and decoding.

We've also combined it with some helpers for responding to content types and parsing
request bodies. Please have a look at the [rest](https://github.com/pressly/chi/blob/master/_examples/rest/main.go)
example which uses the latest chi/render sub-pkg.

All feedback is welcome, thank you!
