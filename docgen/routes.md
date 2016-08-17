IDEAS
#####

1. Generate a routes.json file with all of the details..
2. Create a second tool to generate simple markdown, or html from the JSON file..

{
  project: github.com/pressly/api
  router: {
    middlewares: [
      {
        name: "X",
        description: "x",
        sourcePath: "y"
      },
      Y: {
        description: "x",
        sourcePath: "y"
      }
    ],
    routes: {
      "/": {
        handlers: {
          "GET": {
            description: "making a new thing.."
            middlewares: [o, m, l],
            endpoint: YYY
          },
          "POST": ZZZ
        }
      },
      "/hubs/*": {
        router: {
          middlewares: [],
          routes: {
            "/:id" {
              router: {
                middlewares: [],
                routes: {}
              }
            }
          }
        }
      }
    }
  }
}

/               GET:x POST:y UPDATE:z
/favicon.ico    GET:a
/hubs           GET:m
/hubs/:id
/hubs/:id/posts


PERHAPS... we render something like........

-> RequestID
-> Logger
--
   /
   /favicon.ico
   
   /hubs
   -> HubCtx
   --
      /
      /:id
      -> 

Routes Index
============

/hubs
/hubs/:id
/ok/*

^---- just list each routes then link to each one..

## /hubs

DESCRIPTION (just paste above comment of handler..)

somewhere show the complete path....? /hubs/:id 

| Middleware..
| * ..
------------
| GET  | POST | ....

GET -> MWa -> MWb -> Handler

POST -> etc.......




  ├── configure_todo_list.go
  ├── doc.go
  ├── embedded_spec.go
  └── main.go
  └── /hubs
      /favicon





git:(master) ✗ !? » tree
.
├── cmd
│   └── todo-list-server
│       ├── configure_todo_list.go
│       ├── doc.go
│       ├── embedded_spec.go
│       └── main.go
├── models
│   ├── error.go
│   └── item.go
├── restapi
│   └── operations
│       ├── todo_list_api.go
│       └── todos
│           ├── get.go
│           ├── get_parameters.go
│           └── get_responses.go
└── swagger.yml

╏ : ◉ ∧ ◉ : ╏  ⁞  ⁞   ║  


-------------------------


API Doc for github.com/pressly/api
==================================

# Index

/
/favicon.ico
/hubs
/hubs/:id
/hubs/:id/posts
/
etc..

^--- a link to each of these 

web.Router
----------

## Middleware

* `RequestID` - hmm.. expand and grab godoc heading..?
* `Logger`
* `Recoverer`

## Routes

+---------+----------------------------+---------------+--------------------+
| Method  | Pattern                    | Middleware    | Handler            |
+=========+============================+===============+====================+
| GET     | /                          |               | Index              |
+---------+----------------------------+---------------+--------------------+
| POST    | /hubs/:view                |               | CreateHub          |
+---------+----------------------------+---------------+--------------------+
| OPTIONS | /                          | MWa, MWb, MWc | Sup                |
+---------+----------------------------+---------------+--------------------+
| *       | /other/*                   |               | Other              |
+---------+----------------------------+---------------+--------------------+
| Middlewares:
| * HubCtx
| * PublicHubAcl
+---------+----------------------------+---------------+--------------------+
| GET     | /hubs                      |               | hubs.Index         |
+---------+----------------------------+---------------+--------------------+
| POST    | /hubs                      |               | hubs.Create        |
+---------+----------------------------+---------------+--------------------+
| GET     | /hubs/search               |               | hubs.Search        |
+---------+----------------------------+---------------+--------------------+
| GET     | /hubs/:id                  |               | hubs.Get           |
+---------+----------------------------+---------------+--------------------+
| POST    | /hubs/:id                  |               | hubs.Create        |
+---------+----------------------------+---------------+--------------------+

| Route       | GET      | POST        | ....
| /hubs/:id   | hubs.Get | hubs.Create | 



| Middlewares:
| * PostCtx
+---------+----------------------------+---------------+--------------------+
| GET     | /hubs/posts               |               | hubs.Search         |


+---------+----------------------------+---------------+--------------------+
| *       | 


Subrouter: /hubs

Middleware:
  * x

+---------------------------------------------------------------------------+
| Middlewares                                                               | 
+---------------------------------------------------------------------------+
| * X                                                                       |
| * Y                                                                       |
+---------+----------------------------+---------------+--------------------+

+---------+----------------------------+---------------+--------------------+
| Method  | Pattern                    | Middleware    | Handler            |
+=========+============================+===============+====================+
| GET     | /hubs                      |               | X                  |
+---------+----------------------------+---------------+--------------------+

r.Route("/hubs", func(r chi.Router) {
  r.Use(x)
  r.Get("/", X)
})

## Mounts

* /hubs to hubs.Routes
* /session to sessions.Routes

-------------------------------------------------------------------------
| /


GET / 
