package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/hsluoyz/casbin"
	"github.com/pressly/chi"
)

func testAuthzRequest(t *testing.T, router *chi.Mux, user string, path string, method string, code int) {
	r, _ := http.NewRequest(method, path, nil)
	r.SetBasicAuth(user, "123")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, r)

	if w.Code != code {
		t.Errorf("%s, %s, %s: %d, supposed to be %d", user, path, method, w.Code, code)
	}
}

func TestBasic(t *testing.T) {
	router := chi.NewRouter()

	e := casbin.NewEnforcer("authz_model.conf", "authz_policy.csv")
	router.Use(Authorizer(e))

	// Here we use HTTP basic authentication as the way to get the logged-in user name
	// For simplicity, the credential is not verified, you should implement and use your own
	// authentication before the authorization.
	// In this example, we assume "alice:123" is a legal user.
	router.HandleFunc("/*", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
	})

	testAuthzRequest(t, router, "alice", "/dataset1/resource1", "GET", 200)
	testAuthzRequest(t, router, "alice", "/dataset1/resource1", "POST", 200)
	testAuthzRequest(t, router, "alice", "/dataset1/resource2", "GET", 200)
	testAuthzRequest(t, router, "alice", "/dataset1/resource2", "POST", 403)
}

func TestPathWildcard(t *testing.T) {
	router := chi.NewRouter()

	e := casbin.NewEnforcer("authz_model.conf", "authz_policy.csv")
	router.Use(Authorizer(e))

	// Here we use HTTP basic authentication as the way to get the logged-in user name
	// For simplicity, the credential is not verified, you should implement and use your own
	// authentication before the authorization.
	// In this example, we assume "bob:123" is a legal user.
	router.HandleFunc("/*", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
	})

	testAuthzRequest(t, router, "bob", "/dataset2/resource1", "GET", 200)
	testAuthzRequest(t, router, "bob", "/dataset2/resource1", "POST", 200)
	testAuthzRequest(t, router, "bob", "/dataset2/resource1", "DELETE", 200)
	testAuthzRequest(t, router, "bob", "/dataset2/resource2", "GET", 200)
	testAuthzRequest(t, router, "bob", "/dataset2/resource2", "POST", 403)
	testAuthzRequest(t, router, "bob", "/dataset2/resource2", "DELETE", 403)

	testAuthzRequest(t, router, "bob", "/dataset2/folder1/item1", "GET", 403)
	testAuthzRequest(t, router, "bob", "/dataset2/folder1/item1", "POST", 200)
	testAuthzRequest(t, router, "bob", "/dataset2/folder1/item1", "DELETE", 403)
	testAuthzRequest(t, router, "bob", "/dataset2/folder1/item2", "GET", 403)
	testAuthzRequest(t, router, "bob", "/dataset2/folder1/item2", "POST", 200)
	testAuthzRequest(t, router, "bob", "/dataset2/folder1/item2", "DELETE", 403)
}

func TestRBAC(t *testing.T) {
	router := chi.NewRouter()

	e := casbin.NewEnforcer("authz_model.conf", "authz_policy.csv")
	router.Use(Authorizer(e))

	// Here we use HTTP basic authentication as the way to get the logged-in user name
	// For simplicity, the credential is not verified, you should implement and use your own
	// authentication before the authorization.
	// In this example, we assume "cathy:123" is a legal user.
	router.HandleFunc("/*", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
	})

	// cathy can access all /dataset1/* resources via all methods because it has the dataset1_admin role.
	testAuthzRequest(t, router, "cathy", "/dataset1/item", "GET", 200)
	testAuthzRequest(t, router, "cathy", "/dataset1/item", "POST", 200)
	testAuthzRequest(t, router, "cathy", "/dataset1/item", "DELETE", 200)
	testAuthzRequest(t, router, "cathy", "/dataset2/item", "GET", 403)
	testAuthzRequest(t, router, "cathy", "/dataset2/item", "POST", 403)
	testAuthzRequest(t, router, "cathy", "/dataset2/item", "DELETE", 403)

	// delete all roles on user cathy, so cathy cannot access any resources now.
	e.DeleteRolesForUser("cathy")

	testAuthzRequest(t, router, "cathy", "/dataset1/item", "GET", 403)
	testAuthzRequest(t, router, "cathy", "/dataset1/item", "POST", 403)
	testAuthzRequest(t, router, "cathy", "/dataset1/item", "DELETE", 403)
	testAuthzRequest(t, router, "cathy", "/dataset2/item", "GET", 403)
	testAuthzRequest(t, router, "cathy", "/dataset2/item", "POST", 403)
	testAuthzRequest(t, router, "cathy", "/dataset2/item", "DELETE", 403)
}
