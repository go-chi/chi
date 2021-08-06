<!-- docs/quickstart.md -->

# Quick Start

This tutorial shows how to use `chi` in a simple crud API.
This tutorial is only to show you how an api would look with chi.

## Installation

`go get -u github.com/go-chi/chi/v5`


## Running a Simple Server

The simplest Hello World Api Can look like this.

```go
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

func main() {
	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("Hello World!"))
	})
	http.ListenAndServe(":3000", r)
}
```
```sh
go run main.go
```
Browse to `http://localhost:3000`, and you should see `Hello World!` on the page.

## Adding Usefull Middleware
```go
package main

import (
	//...
	"net/http"
	"time"

	"context"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)


func main(){
	r := chi.NewRouter()
	

	r.Use(middleware.RequestID)
	
	// RealIP is a middleware that sets a http.Request's RemoteAddr to the results
	// of parsing either the X-Real-IP header or the X-Forwarded-For header (in that
	// order).
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)

	// Recoverer is a middleware that recovers from panics, logs the panic (and a
	// backtrace), and returns a HTTP 500 (Internal Server Error) status if
	// possible. Recoverer prints a request ID if one is provided.
	r.Use(middleware.Recoverer)

	// CleanPath middleware will clean out double slash mistakes from a user's request path.
	// For example, if a user requests /users//1 or //users////1 will both be treated as: /users/1
	r.Use(middleware.CleanPath)

	// Set a timeout value on the request context (ctx), that will signal
	// through ctx.Done() that the request has timed out and further
	// processing should be stopped.
	r.Use(middleware.Timeout(60 * time.Second))

	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("Hello World!"))
	})

}
```

## Adding Simple CRUD Patterns

### Creating a Simple Structs for Models
We will create a simple todo and User struct to work as a model
```go
// Todo struct is a model for creating todos
type Todo struct {
	ID       int32  `json:"id"`
	Body     string `json:"body"`
	Username string `json:"username"`
	Done     bool   `json:"done"`
}

// User struct is a model for users
type User struct {
	Username string `json:"username"`
	Password string `json:"password"`
}
```

### Replicating a Temporary DB store
```go
// Store is used to replicate a database store
type Store struct {
	Users map[string]User // username:User
	TODOs map[int32]Todo  // id:Todo
}

// GetUser gets the User Model from Store by username
func (s *Store) GetUser(username string) (User, error) {
	user, ok := s.Users[username]
	if !ok {
		return User{}, fmt.Errorf("user with username: %s, does not exist", username)
	}
	return user, nil
}

// AddUser creates a new user and adds it to the store
func (s *Store) AddUser(user User) error {
	_, ok := s.Users[user.Username]
	if ok {
		return fmt.Errorf("user with username: %s, already exists", user.Username)
	}
	s.Users[user.Username] = user
	return nil
}

// CreateTodo creates a new todo and stores it in the store
func (s *Store) CreateTodo(body string, username string) {
	id := int32(len(s.TODOs) + 1)
	s.TODOs[id] = Todo{
		ID:       id,
		Body:     body,
		Username: username,
		Done:     false,
	}
	fmt.Println(s.TODOs)
}

// GetAllToDo gets all todos created by a user
func (s *Store) GetAllToDo(username string) (todos []Todo) {
	fmt.Println(s.TODOs)
	for i := 1; i <= len(s.TODOs); i++ {
		todo := s.TODOs[int32(i)]
		fmt.Println(todo, username)
		if todo.Username == username {
			fmt.Println(todo)
			todos = append(todos, todo)
		}
	}
	return
}

// DeleteToDo deletes the todo from the store
func (s *Store) DeleteToDo(id int32) error {
	_, ok := s.TODOs[id]
	if !ok {
		return fmt.Errorf("todo with id: %v, does not exist", id)
	}
	delete(s.TODOs, id)
	return nil
}

// ModifyToDo modifies the todo in the store
func (s *Store) ModifyToDo(id int32, body string, done bool, username string) error {
	todo, ok := s.TODOs[id]
	if !ok {
		return fmt.Errorf("todo with id: %v, does not exist", id)
	}
	if todo.Username != username {
		return fmt.Errorf("you are not the owner of this todo")
	}
	todo.Body = body
	todo.Done = done
	s.TODOs[id] = todo
	return nil
}
```
### Creating a Response Util
```go
// JSON returns a well formatted response with a status code
func JSON(w http.ResponseWriter, statusCode int, data interface{}) {
	w.WriteHeader(statusCode)
	err := json.NewEncoder(w).Encode(data)
	if err != nil {
		w.WriteHeader(500)
		er := json.NewEncoder(w).Encode(map[string]interface{}{"error": "something unexpected occurred."})
		if er != nil {
			return
		}
	}
}
```
### Creating Handlers
```go

// SignUpHandler responsds to /auth/signup
// it is used for creating a user
func SignUpHandler(store *Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		resp := map[string]string{"error": "something unexpected occurred"}

		decoder := json.NewDecoder(r.Body) // "encoding/json"
		params := &User{}
		err := decoder.Decode(params) // Parsing request and storing it in a User Model
		if err != nil {
			log.Println(err)
			JSON(w, 500, resp)
			return
		}
		// Checking for empty username or password
		if params.Username == "" || params.Password == "" {
			resp["error"] = "username and password are required"
			JSON(w, 400, resp)
			return
		}
		err = store.AddUser(*params)
		if err != nil {
			resp["error"] = err.Error()
			JSON(w, 400, resp)
		}
		JSON(w, 201, map[string]string{"response": "user created"})
	}
}

// CreateToDoHandler responds to POST /todo/create
// it creates a new todo model
func CreateToDoHandler(store *Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		resp := map[string]string{"error": "something unexpected occurred"}
		decoder := json.NewDecoder(r.Body)
		params := &Todo{}
		err := decoder.Decode(params)
		if err != nil {
			log.Println(err)
			JSON(w, 500, resp)
			return
		}
		if params.Body == "" {
			resp["error"] = "body is required"
			JSON(w, 400, resp)
			return
		}

		// Getting Username of Logged In User set by auth middleware
		params.Username = r.Context().Value("username").(string)
		store.CreateTodo(params.Body, params.Username)
		JSON(w, 201, map[string]string{"response": "todo created"})
	}
}

// GetAllToDoHandler responds to GET /todo/all
// returns all todo related to a user
func GetAllToDoHandler(store *Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		todos := store.GetAllToDo(r.Context().Value("username").(string))
		JSON(w, 200, todos)
	}
}

// DeleteToDoHandler responds to DELETE /todo/delete/{id}
// it deletes the todo if it exists and was created by the logged in user
func DeleteToDoHandler(store *Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var resp map[string]interface{} = map[string]interface{}{}

		id, err := strconv.Atoi(chi.URLParam(r, "id"))
		if err != nil {
			resp["error"] = "something unexpected occured"
			JSON(w, http.StatusInternalServerError, resp)
			return
		}
		todo, ok := store.TODOs[int32(id)]
		if !ok {
			resp["error"] = fmt.Sprintf("todo with id: %v, does not exist", id)
			JSON(w, 400, resp)
			return
		}
		if todo.Username != r.Context().Value("username").(string) {
			resp["error"] = "you did not create this todo"
			JSON(w, 400, resp)
			return
		}
		delete(store.TODOs, int32(id))
		resp["response"] = "deleted todo"
		JSON(w, 200, resp)
	}
}

func ModifyToDoHandler(store *Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		resp := map[string]string{"error": "something unexpected occurred"}
		decoder := json.NewDecoder(r.Body)
		params := &Todo{}
		err := decoder.Decode(params)
		if err != nil {
			log.Println(err)
			JSON(w, 500, resp)
			return
		}
		if params.Body == "" || params.ID == 0 {
			resp["error"] = "body and id are required"
			JSON(w, 400, resp)
			return
		}

		params.Username = r.Context().Value("username").(string)
		err = store.ModifyToDo(params.ID, params.Body, params.Done, params.Username)
		// store.CreateToDo(params.Body, params.Username)
		if err != nil {
			resp["error"] = err.Error()
			JSON(w, 400, resp)
			return
		}
		JSON(w, 201, map[string]string{"response": "todo modified"})
	}
}

```

## Creating Middlewares

### Auth Middleware
```go
// AuthMiddleware expects username and password in Header
// This is only to show you how to use middleware
// This is not at all meant for production
func AuthMiddleware(store *Store) func(next http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var resp = map[string]interface{}{"error": "unauthorized", "message": "missing authorization"}
			var username = r.Header.Get("username")
			var password = r.Header.Get("password")
			username = strings.TrimSpace(username)
			password = strings.TrimSpace(password)
			if username == "" || password == "" {
				JSON(w, http.StatusUnauthorized, resp)
				return
			}
			// Confirming username and password are correct
			user, err := store.GetUser(username)
			if err != nil {
				resp["message"] = err.Error()
				JSON(w, http.StatusUnauthorized, resp)
				return
			}
			if user.Password != password {
				resp["message"] = "password is incorrect"
				JSON(w, http.StatusUnauthorized, resp)
				return
			}
			// Setting username in context
			ctx := context.WithValue(r.Context(), "username", username)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

```

### Middleware for settings content-type
```go
// SetContentTypeMiddleware sets content-type to json
func SetContentTypeMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		next.ServeHTTP(w, r)
	})
}
```

## Adding Route Groups and Finishing it
```go
func main() {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)

	// RealIP is a middleware that sets a http.Request's RemoteAddr to the results
	// of parsing either the X-Real-IP header or the X-Forwarded-For header (in that
	// order).
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)

	// Recoverer is a middleware that recovers from panics, logs the panic (and a
	// backtrace), and returns a HTTP 500 (Internal Server Error) status if
	// possible. Recoverer prints a request ID if one is provided.
	r.Use(middleware.Recoverer)

	// CleanPath middleware will clean out double slash mistakes from a user's request path.
	// For example, if a user requests /users//1 or //users////1 will both be treated as: /users/1
	r.Use(middleware.CleanPath)

	// Set a timeout value on the request context (ctx), that will signal
	// through ctx.Done() that the request has timed out and further
	// processing should be stopped.
	r.Use(middleware.Timeout(60 * time.Second))

	// Initializing our db store
	store := Store{
		Users: map[string]User{},
		TODOs: map[int32]Todo{},
	}

	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("Hello World!"))
	})

	// Creating a New Router for todo handlers
	todoRouter := chi.NewRouter()

	// Use Content-Type Middleware
	todoRouter.Use(SetContentTypeMiddleware)

	// Use Auth Middleware since these are protected Routes
	todoRouter.Use(AuthMiddleware(&store))
	todoRouter.Get("/all", GetAllToDoHandler(&store))
	todoRouter.Post("/create", CreateToDoHandler(&store))
	todoRouter.Put("/modify", ModifyToDoHandler(&store))
	todoRouter.Delete("/delete/{id}", DeleteToDoHandler(&store))

	// Creating New Router for User Authentication
	userAuthRouter := chi.NewRouter()
	userAuthRouter.Use(SetContentTypeMiddleware)
	userAuthRouter.Post("/signup", SignUpHandler(&store))

	// Mounting Both Sub Routers to a path in the main router
	r.Mount("/todo", todoRouter)
	r.Mount("/auth", userAuthRouter)

	// Starting the Server
	http.ListenAndServe("localhost:5000", r)
}

```

This was a small simple tutorial just to show you how to use the basic features
of `chi`

To Learn More Visit [The Advanced User Guide](advanced_user_guide/index.md)