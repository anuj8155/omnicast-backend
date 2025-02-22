import React, { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import "./styles.css";

const StreamyardClone = () => {
  const userVideoRef = useRef(null);
  const [mediaStream, setMediaStream] = useState(null);
  const [rtmpUrls, setRtmpUrls] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [currentDateTime, setCurrentDateTime] = useState("2025-02-20 09:30:53");
  const [messages, setMessages] = useState([
    { id: 1, platform: "Local", user: "John Doe", message: "Hello everyone!", timestamp: "09:24:15" },
    { id: 2, platform: "Local", user: "Jane Smith", message: "Great stream!", timestamp: "09:25:30" },
    { id: 3, platform: "Local", user: "Mike Johnson", message: "Looking forward to today's content", timestamp: "09:26:00" }
  ]);
  const [newMessage, setNewMessage] = useState("");
  const [viewerCount, setViewerCount] = useState({}); // { platform: count }
  const socket = useRef(null);
  const connectionAttempts = useRef(0);

  useEffect(() => {
    // Update date and time every second
    const timer = setInterval(() => {
      const now = new Date();
      const formatted = now.toISOString().replace('T', ' ').slice(0, 19);
      setCurrentDateTime(formatted);
    }, 1000);

    socket.current = io("http://localhost:4000", {
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: 10000,
    });

    socket.current.on("connect", () => {
      setStatusMessage("Connected to streaming server");
      connectionAttempts.current = 0;
    });

    socket.current.on("disconnect", () => {
      setStatusMessage("Disconnected from server");
      setIsStreaming(false);
      stopMediaRecorder();
    });

    socket.current.on("connect_error", (err) => {
      connectionAttempts.current += 1;
      setStatusMessage(`Connection error: ${err.message} (Attempt ${connectionAttempts.current})`);
    });

    socket.current.on("stream_status", (data) => {
      if (data.status === 'started') {
        setIsStreaming(true);
        setStatusMessage(`Streaming: ${data.message}`);
      } else if (data.status === 'stopped') {
        setIsStreaming(false);
        setStatusMessage(`Stream stopped: ${data.message}`);
        stopMediaRecorder();
      } else if (data.status === 'error') {
        setStatusMessage(`Error: ${data.message}`);
        setIsStreaming(false);
        stopMediaRecorder();
      }
    });

    socket.current.on("chat_update", (chats) => {
      setMessages((prev) => [
        ...prev.filter((msg) => msg.platform === "Local"), // Keep local messages
        ...chats.map((chat, index) => ({
          id: prev.length + index + 1,
          platform: chat.platform,
          user: chat.user,
          message: chat.message,
          timestamp: chat.timestamp,
        })),
      ]);
    });

    socket.current.on("viewer_update", (counts) => {
      setViewerCount(counts); // Update viewer counts for platforms
    });

    getMediaStream();

    return () => {
      clearInterval(timer);
      if (isStreaming) {
        stopStreaming();
      }
      if (socket.current) {
        socket.current.disconnect();
      }
      if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const getMediaStream = async () => {
    try {
      const constraints = {
        audio: true,
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        }
      };
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      setMediaStream(stream);
      
      if (userVideoRef.current) {
        userVideoRef.current.srcObject = stream;
      }
      
      setStatusMessage("Camera and microphone ready");
    } catch (error) {
      setStatusMessage(`Media access error: ${error.message}`);
    }
  };

  const stopMediaRecorder = () => {
    if (mediaRecorder) {
      try {
        mediaRecorder.stop();
      } catch (error) {
        console.error("Error stopping media recorder:", error);
      }
      setMediaRecorder(null);
    }
  };

  const startStreaming = () => {
    if (!mediaStream) {
      setStatusMessage("No media stream available!");
      return;
    }

    const urlsArray = rtmpUrls
      .split(",")
      .map((url) => url.trim())
      .filter((url) => url !== "");

    if (urlsArray.length === 0) {
      setStatusMessage("Please enter at least one RTMP URL!");
      return;
    }

    const validUrls = urlsArray.every(url => 
      url.startsWith('rtmp://') || url.startsWith('rtmps://')
    );

    if (!validUrls) {
      setStatusMessage("URLs must start with rtmp:// or rtmps://");
      return;
    }

    socket.current.emit("set_rtmp_urls", urlsArray);
    setStatusMessage("Starting stream...");

    try {
      const recorderOptions = {
        mimeType: 'video/webm;codecs=h264',
        videoBitsPerSecond: 1000000,
        audioBitsPerSecond: 128000
      };
      
      const recorder = new MediaRecorder(mediaStream, recorderOptions);
      
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0 && socket.current && socket.current.connected) {
          socket.current.emit("binarystream", event.data);
        }
      };
      
      recorder.start(100);
      setMediaRecorder(recorder);
    } catch (error) {
      setStatusMessage(`Failed to start stream: ${error.message}`);
      socket.current.emit("stop_streaming");
    }
  };

  const stopStreaming = () => {
    setStatusMessage("Stopping stream...");
    
    if (socket.current && socket.current.connected) {
      socket.current.emit("stop_streaming");
    }
    
    stopMediaRecorder();
    setIsStreaming(false);
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (newMessage.trim()) {
      const now = new Date();
      const timestamp = now.toTimeString().split(' ')[0];
      setMessages(prev => [...prev, {
        id: prev.length + 1,
        platform: "Local",
        user: "anuj8155",
        message: newMessage.trim(),
        timestamp: timestamp
      }]);
      setNewMessage("");
    }
  };

  return (
    <div className="youtube-dashboard">
      <header className="dashboard-header">
        <div className="header-left">
          <h1>Stream-X</h1>
        </div>
        <div className="header-right">
          <div className="user-info">
            <span className="datetime">{currentDateTime}</span>
            <span className="username">anuj8155</span>
          </div>
        </div>
      </header>

      <div className="dashboard-content">
        <div className="main-section">
          <div className="video-preview">
            <video
              ref={userVideoRef}
              autoPlay
              muted
              playsInline
              className="preview-video"
            ></video>
            <div className="stream-status">
              {isStreaming ? (
                <span className="live-indicator">● LIVE</span>
              ) : (
                <span className="offline-indicator">OFFLINE</span>
              )}
            </div>
          </div>

          <div className="stream-details">
            <div className="title-section">
              <input 
                type="text" 
                placeholder="Add a title that describes your stream" 
                className="stream-title"
              />
              <textarea 
                placeholder="Tell viewers about your stream" 
                className="stream-description"
              />
            </div>
          </div>
        </div>

        <div className="chat-section">
          <div className="chat-header">
            <h3>Live Chat</h3>
            <span className="chat-status">{isStreaming ? 'Live Chat' : 'Chat Disabled'}</span>
          </div>
          
          <div className="chat-messages">
            {messages.map(msg => (
              <div key={msg.id} className="chat-message">
                <span className="message-timestamp">{msg.timestamp}</span>
                <span className="message-platform">{msg.platform}</span>
                <span className="message-user">{msg.user}</span>
                <span className="message-text">{msg.message}</span>
              </div>
            ))}
          </div>
          
          <form onSubmit={handleSendMessage} className="chat-input-container">
            <input
              type="text"
              placeholder="Send a message"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              disabled={!isStreaming}
              className="chat-input"
            />
            <button 
              type="submit" 
              disabled={!isStreaming || !newMessage.trim()} 
              className="chat-send-button"
            >
              Send
            </button>
          </form>
        </div>

        <div className="stream-controls">
          <div className="status-panel">
            <h3>Stream Status</h3>
            <div className={`status-indicator ${isStreaming ? 'live' : 'ready'}`}>
              {statusMessage}
            </div>
          </div>

          <div className="viewer-panel">
            <h3>Viewer Count</h3>
            <div className="viewer-stats">
              {Object.entries(viewerCount).map(([platform, count]) => (
                <div key={platform} className="viewer-stat">
                  <span>{platform}: </span>
                  <span>{count}</span>
                </div>
              ))}
              <div className="viewer-stat">
                <span>Total: </span>
                <span>{Object.values(viewerCount).reduce((sum, count) => sum + count, 0)}</span>
              </div>
            </div>
          </div>

          <div className="rtmp-section">
            <label>RTMP URL</label>
            <textarea
              className="rtmp-input"
              placeholder="Enter your RTMP URL"
              value={rtmpUrls}
              onChange={(e) => setRtmpUrls(e.target.value)}
              disabled={isStreaming}
            />
          </div>

          <button
            onClick={isStreaming ? stopStreaming : startStreaming}
            className={`stream-button ${isStreaming ? 'stop' : 'start'}`}
            disabled={!mediaStream}
          >
            {isStreaming ? 'End Stream' : 'Go Live'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default StreamyardClone;