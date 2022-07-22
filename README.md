# chio

chio is a fork of [chi](https://github.com/go-chi/chi).
It is upgraded to go 1.18.
It replaces most of the included middleware.
It also adds some useful helpers for building REST APIs.

## Documentation

See [chi](https://github.com/go-chi/chi) for the README.
The API of the package has not changed except that it is called chio instead of chi.

## middleware

### BasicAuth

BasicAuth middleware is more extensible than the original, allowing you to do your own password verification.

### Compress

Compress is unchanged.

### Recover

Unlike the original Recoverer, Recover lets you decide what to do when recovering. It provides a useful stack trace that only goes until the panic call.

A default logger is provided that writes call information, panic value and a stack trace to a io.Writer.

### SetValue

SetValue allows you to make your own middlewares (for auth for example) that pass values (such as user metadata) to other middlewares or handlers.
A value set with SetValue can be easily retrieved using GetValue.

## response

this package provides helpers for writing status headers and encoding. Supported:

* Empty response
  * `NoContent`
* Text response
  * `String`
* JSON response
  * `JSON`
* XML response
  * `XML`
* Binary response
  * `StreamBlob`
  * `Blob`

## route

this package provides wrappers for automatically decoding requests. Currently it only contains one function, `route.JSON`.
