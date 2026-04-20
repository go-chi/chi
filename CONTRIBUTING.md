# Contributing

## Prerequisites

1. [Install Go][go-install].
2. Clone the repository and switch the working directory:

    ```bash
    git clone https://github.com/go-chi/chi.git
    cd chi
    ```

## Submitting a Pull Request

A typical workflow is:

1. [Fork the repository.][fork]
2. [Create a topic branch.][branch]
3. Implement the change.
4. Add tests for your change.
5. Run `go test ./...`. If your tests fail, return to steps 3 and 4.
6. Run `goimports -w .` to ensure the new code conforms to Go formatting guidelines.
7. [Add, commit and push your changes.][git-help]
8. [Submit a pull request.][pull-req]

[go-install]: https://golang.org/doc/install
[fork]: https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/fork-a-repo
[branch]: https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/about-branches 
[git-help]: https://docs.github.com/en
[pull-req]: https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/about-pull-requests
