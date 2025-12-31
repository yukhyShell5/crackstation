package worker

import (
	"bufio"
	"bytes"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/google/uuid"
)

type Worker struct {
	ID         string
	ServerURL  string
	ForceJobID string
	Client     *http.Client
}

type JobChunk struct {
	ID      string `json:"id"`
	JobID   string `json:"jobId"`
	Start   int    `json:"start"`
	End     int    `json:"end"`
	Hash    string `json:"hash"`    // Provided by server for context
	Charset string `json:"charset"` // Dynamic charset for this job
}

type ChunkResponse struct {
	Chunk *JobChunk `json:"chunk"`
}

func New(serverURL string, forceJobID string) *Worker {
	return &Worker{
		ID:         uuid.New().String(),
		ServerURL:  serverURL,
		ForceJobID: forceJobID,
		Client:     &http.Client{}, // No timeout for SSE
	}
}

func (w *Worker) Start() {
	log.Printf("Starting worker %s", w.ID)

	// 1. Handshake
	if err := w.handshake(); err != nil {
		log.Fatalf("Handshake failed: %v", err)
	}
	log.Println("Connected to Crackstation Manager")

	// 2. Start Heartbeat (Background)
	go w.startHeartbeat()

	// 3. Chunk Loop (SSE)
	// Connect to stream and block
	go w.subscribeToStream()

	// 4. Wait for signal
	c := make(chan os.Signal, 1)
	signal.Notify(c, os.Interrupt, syscall.SIGTERM)
	<-c
	log.Println("Shutting down worker...")
	// Cleanup/Disconnect logic if needed
	os.Exit(0)
}

func (w *Worker) handshake() error {
	resp, err := w.Client.Get(w.ServerURL + "/api/info")
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("server returned status: %d", resp.StatusCode)
	}

	body, _ := io.ReadAll(resp.Body)
	if !bytes.Contains(body, []byte("Crackstation Manager")) {
		return fmt.Errorf("invalid server response: %s", string(body))
	}

	return nil
}

func (w *Worker) startHeartbeat() {
	ticker := time.NewTicker(5 * time.Second)
	for range ticker.C {
		payload := map[string]string{
			"id":        w.ID,
			"ip":        "127.0.0.1", // Simplified
			"userAgent": "Go-Client/1.0",
		}
		jsonPayload, _ := json.Marshal(payload)

		_, err := w.Client.Post(w.ServerURL+"/api/ping", "application/json", bytes.NewBuffer(jsonPayload))
		if err != nil {
			log.Printf("Heartbeat failed: %v", err)
		}
	}
}

func (w *Worker) subscribeToStream() {
	url := fmt.Sprintf("%s/api/worker/stream?clientId=%s", w.ServerURL, w.ID)
	if w.ForceJobID != "" {
		url += fmt.Sprintf("&jobId=%s", w.ForceJobID)
	}

	log.Printf("Connecting to stream: %s", url)

	// Using basic http client for stream
	resp, err := w.Client.Get(url)
	if err != nil {
		log.Fatalf("Failed to connect to stream: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Fatalf("Stream connection failed: %d", resp.StatusCode)
	}

	reader := bufio.NewReader(resp.Body)

	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			if err == io.EOF {
				log.Println("Stream closed by server, reconnecting...")
				time.Sleep(1 * time.Second)
				w.subscribeToStream()
				return
			}
			log.Printf("Error reading stream: %v", err)
			return
		}

		// Parse SSE "data: {...}"
		if strings.HasPrefix(line, "data: ") {
			data := strings.TrimPrefix(line, "data: ")
			data = strings.TrimSpace(data)

			if data == "" {
				continue
			}

			var chunkResp ChunkResponse
			if err := json.Unmarshal([]byte(data), &chunkResp); err != nil {
				log.Printf("Failed to decode chunk event: %v", err)
				continue
			}

			if chunkResp.Chunk != nil {
				chunk := chunkResp.Chunk
				log.Printf("Picked up chunk %s for Job %s (Range: %d-%d)", chunk.ID, chunk.JobID, chunk.Start, chunk.End)

				// Simulate work
				start := time.Now()
				// Use charset from chunk, or default if missing (for backward compat/dummy jobs)
				charset := chunk.Charset
				if charset == "" {
					charset = "abcdefghijklmnopqrstuvwxyz0123456789"
				}

				result := w.crack(chunk.Hash, chunk.Start, chunk.End, charset)
				elapsed := time.Since(start).Seconds()

				hashCount := chunk.End - chunk.Start + 1
				hashrate := float64(hashCount) / elapsed

				// Submit result (Implicitly triggers next dispatch)
				w.submitResult(chunk.ID, result, hashrate)
			}
		}
	}
}

func (w *Worker) crack(hash string, start int, end int, charset string) string {
	// Optimization: Zero-allocation using byte slice
	currentBytes := indexToBytes(start, charset)
	targetBytes, _ := hex.DecodeString(hash)

	log.Printf("Cracking range %d-%d for hash %s (Charset: %d chars)", start, end, hash, len(charset))

	for i := start; i <= end; i++ {
		// MD5 of currentBytes
		sum := md5.Sum(currentBytes)

		// Compare bytes directly
		if bytes.Equal(sum[:], targetBytes) {
			return string(currentBytes)
		}

		// Prepare for next iteration
		if i < end {
			incrementBytes(currentBytes, charset)
		}
	}

	return ""
}

func indexToBytes(n int, charset string) []byte {
	charsetLen := len(charset)
	if n == 0 {
		return []byte{charset[0]}
	}

	var s []byte
	for {
		r := n % charsetLen
		s = append([]byte{charset[r]}, s...)
		n = n/charsetLen - 1
		if n < 0 {
			break
		}
	}
	return s
}

func incrementBytes(b []byte, charset string) {
	charsetLen := len(charset)
	n := len(b)
	for i := n - 1; i >= 0; i-- {
		charIdx := strings.IndexByte(charset, b[i])
		if charIdx < charsetLen-1 {
			b[i] = charset[charIdx+1]
			return
		}
		b[i] = charset[0]
	}
	// No length overflow handling as discussed
}

func (w *Worker) submitResult(chunkID string, result string, hashrate float64) {
	payload := map[string]interface{}{
		"result":   result,
		"hashrate": hashrate,
	}
	jsonPayload, _ := json.Marshal(payload)

	_, err := w.Client.Post(fmt.Sprintf("%s/api/jobs/chunk/%s/complete", w.ServerURL, chunkID), "application/json", bytes.NewBuffer(jsonPayload))
	if err != nil {
		log.Printf("Failed to submit result: %v", err)
	} else {
		hashrateStr := fmt.Sprintf("%.2f H/s", hashrate)
		if hashrate > 1000000 {
			hashrateStr = fmt.Sprintf("%.2f MH/s", hashrate/1000000)
		} else if hashrate > 1000 {
			hashrateStr = fmt.Sprintf("%.2f kH/s", hashrate/1000)
		}

		if result != "" {
			log.Printf("Chunk %s FOUND RESULT: %s (%s)", chunkID, result, hashrateStr)
		} else {
			log.Printf("Chunk %s completed (%s)", chunkID, hashrateStr)
		}
	}
}
