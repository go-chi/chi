package middleware

// This plugin is based on Casbin: an authorization library that supports ACL, RBAC, ABAC
// View source at:
// https://github.com/hsluoyz/casbin

import (
	"net/http"

	"github.com/hsluoyz/casbin"
)

// Authz is a middleware that controls the access to the HTTP service, it is based
// on Casbin, which supports access control models like ACL, RBAC, ABAC.
// The plugin determines whether to allow a request based on (user, path, method).
// user: the authenticated user name.
// path: the URL for the requested resource.
// method: one of HTTP methods like GET, POST, PUT, DELETE.
//
// This middleware should be inserted fairly early in the middleware stack to
// protect subsequent layers. All the denied requests will not go further.
//
// It's notable that this middleware should be behind the authentication (e.g.,
// HTTP basic authentication, OAuth), so this plugin can get the logged-in user name
// to perform the authorization.
func Authorizer(e *casbin.Enforcer) func(next http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		fn := func(w http.ResponseWriter, r *http.Request) {
			user, _, _ := r.BasicAuth()
			method := r.Method
			path := r.URL.Path
			if e.Enforce(user, path, method) {
				next.ServeHTTP(w, r)
			} else {
				http.Error(w, http.StatusText(403), 403)
			}
		}

		return http.HandlerFunc(fn)
	}
}
