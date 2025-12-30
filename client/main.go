package main

import (
	"client/worker"
	"flag"
	"fmt"
	"os"
)

func main() {
	serverURL := flag.String("server", "http://localhost:3000", "URL of the Crackstation Manager")
	jobID := flag.String("job", "", "Optional: Force execute a specific Job ID")
	help := flag.Bool("help", false, "Show help")

	flag.Parse()

	if *help {
		fmt.Println("Crackstation Client")
		flag.PrintDefaults()
		os.Exit(0)
	}

	fmt.Printf("Connecting to %s...\n", *serverURL)
	if *jobID != "" {
		fmt.Printf("Forcing job ID: %s\n", *jobID)
	}

	w := worker.New(*serverURL, *jobID)
	w.Start()
}
