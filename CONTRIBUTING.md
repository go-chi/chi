# Contributing

## Prerequisites

1. [Install Go][go-install].
2. [Fork the repository][fork], then clone your fork and switch the working directory.
   Replace `YOUR_USERNAME` with your GitHub username:

    ```bash
    git clone https://github.com/YOUR_USERNAME/chi.git
    cd chi
    ```

## Submitting a Pull Request

A typical workflow is:

1. Complete the prerequisites above.
2. [Create a topic branch.][branch]
3. Add tests for your change.
4. Run `go test ./...` to test all packages, including middleware. If your tests pass, return to step 3.
5. Implement the change and ensure the steps from the previous step pass.
6. Run `goimports -w .`, to ensure the new code conforms to Go formatting guideline.
7. [Add, commit and push your changes.][git-help]
8. [Submit a pull request.][pull-req]

[go-install]: https://golang.org/doc/install
[fork]: https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/fork-a-repo
[branch]: https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/about-branches 
[git-help]: https://docs.github.com/en
[pull-req]: https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/about-pull-requests

