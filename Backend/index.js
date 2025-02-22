const http = require("http");
const express = require("express");
const SocketIO = require("socket.io").Server;
const { spawn } = require("child_process");
const app = express();
const server = http.createServer(app);
const io = new SocketIO(server, { cors: { origin: "*" } });
const port = process.env.PORT || 4000;


let ffmpegProcesses = new Map();

let viewerCounts = new Map();
let platformChats = new Map(); 



// Function to start FFmpeg for multiple RTMP URLs
const startFFmpeg = (urls, socketId) => {
  if (ffmpegProcesses.has(socketId)) {
    try {
      const oldProcess = ffmpegProcesses.get(socketId);
      console.log(`Killing previous FFmpeg process for ${socketId}`);
      oldProcess.stdin.end();
      oldProcess.kill("SIGINT");
    } catch (err) {
      console.error(`Error stopping previous FFmpeg: ${err.message}`);
    }
  }

  console.log(`Starting FFmpeg for socket ${socketId} with URLs:`, urls);
  
  try {
    const outputArgs = [];
    urls.forEach(url => {
      outputArgs.push('-f', 'flv', url);
    });
    
    const args = [
      '-re', '-i', 'pipe:0', '-c:v', 'libx264', '-preset', 'veryfast',
      '-tune', 'zerolatency', '-b:v', '1000k', '-maxrate', '1000k',
      '-bufsize', '2000k', '-g', '30', '-r', '30', '-c:a', 'aac',
      '-b:a', '128k', '-ar', '44100', '-f', 'tee', '-map', '0:v', '-map', '0:a'
    ];
    
    const teeOutputs = urls.map(url => `[f=flv:onfail=ignore]${url}`).join('|');
    args.push(teeOutputs);
    
    console.log("FFmpeg command:", "ffmpeg", args.join(' '));
    
    const ffmpeg = spawn('ffmpeg', args);
    
    ffmpeg.stderr.setEncoding('utf8');
    ffmpeg.stderr.on('data', (data) => {
      if (data.includes('Error') || data.includes('warning') || 
          data.includes('Opening') || data.includes('frame=')) {
        console.log(`[FFmpeg ${socketId}] ${data.trim()}`);
      }
    });
    
    ffmpeg.on('error', (err) => {
      console.error(`FFmpeg process error: ${err.message}`);
      io.to(socketId).emit('stream_status', {
        status: 'error',
        message: `FFmpeg error: ${err.message}`
      });
    });
    
    ffmpeg.on('exit', (code, signal) => {
      console.log(`FFmpeg process exited with code ${code} and signal ${signal}`);
      ffmpegProcesses.delete(socketId);
      io.to(socketId).emit('stream_status', {
        status: 'stopped',
        message: `Stream ended (code: ${code})`
      });
    });
    
    ffmpegProcesses.set(socketId, ffmpeg);
    io.to(socketId).emit('stream_status', {
      status: 'started',
      message: `Streaming to ${urls.length} destination(s)`
    });
    
    return ffmpeg;
  } catch (error) {
    console.error(`Failed to start FFmpeg: ${error.message}`);
    io.to(socketId).emit('stream_status', {
      status: 'error',
      message: `Failed to start FFmpeg: ${error.message}`
    });
    return null;
  }
};

// Simulate platform data with fixed viewer counts
const simulatePlatformData = (socketId, urls) => {
  // Predefined viewer counts for testing
  const predefinedCounts = {
    "Instagram": 30,
    "YouTube": 3000,
    "Facebook": 49,
    "Twitch": 75, // Example additional platform, adjust as needed
    "Unknown": 10 // Default for unrecognizable URLs
  };

  setInterval(() => {
    const counts = {};
    const chats = platformChats.get(socketId) || [];
    
    urls.forEach((url) => {
      let platform = "Unknown";
      if (url.includes("instagram")) platform = "Instagram";
      else if (url.includes("youtube")) platform = "YouTube";
      else if (url.includes("facebook")) platform = "Facebook";
      else if (url.includes("twitch")) platform = "Twitch";

      // Assign predefined viewer count based on platform
      counts[platform] = predefinedCounts[platform] || predefinedCounts["Unknown"];

      // Simulate chat messages (unchanged from original)
      chats.push({
        platform,
        user: `User_${Math.floor(Math.random() * 1000)}`,
        message: `Sample message from ${platform}`,
        timestamp: new Date().toTimeString().split(" ")[0],
      });
    });

    viewerCounts.set(socketId, counts);
    platformChats.set(socketId, chats.slice(-50)); // Keep last 50 messages
    io.to(socketId).emit("viewer_update", counts);
    io.to(socketId).emit("chat_update", platformChats.get(socketId));
  }, 5000); // Update every 5 seconds
};



app.post('/api/increment-counter', (req, res) => {
    liveCounter++;
    res.json({ counter: liveCounter });
});

app.get('/api/get-counter', (req, res) => {
    res.json({ counter: liveCounter });
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});

// Socket connection handler
io.on("connection", (socket) => {
  console.log(`New client connected: ${socket.id}`);
  
  socket.on("set_rtmp_urls", (urls) => {
    console.log(`Received RTMP URLs from ${socket.id}:`, urls);
    startFFmpeg(urls, socket.id);
    simulatePlatformData(socket.id, urls);
  });
  
  socket.on("binarystream", (chunk) => {
    const ffmpeg = ffmpegProcesses.get(socket.id);
    if (!ffmpeg) {
      console.log(`No FFmpeg process for ${socket.id}, ignoring stream data`);
      socket.emit('stream_status', { status: 'error', message: 'FFmpeg not running' });
      return;
    }
    try {
      const success = ffmpeg.stdin.write(chunk);
      if (!success) {
        console.log(`Buffer full for ${socket.id}, waiting for drain`);
        ffmpeg.stdin.once('drain', () => {
          console.log(`Buffer drained for ${socket.id}`);
        });
      }
    } catch (error) {
      console.error(`Error writing to FFmpeg: ${error.message}`);
      socket.emit('stream_status', { status: 'error', message: `Stream write error: ${error.message}` });
    }
  });
  
  socket.on("stop_streaming", () => {
    console.log(`Stop streaming requested by ${socket.id}`);
    if (ffmpegProcesses.has(socket.id)) {
      const ffmpeg = ffmpegProcesses.get(socket.id);
      console.log(`Stopping FFmpeg for ${socket.id}`);
      try {
        ffmpeg.stdin.end();
        setTimeout(() => {
          if (ffmpegProcesses.has(socket.id)) {
            ffmpeg.kill('SIGKILL');
          }
        }, 2000);
      } catch (error) {
        console.error(`Error stopping FFmpeg: ${error.message}`);
      }
      ffmpegProcesses.delete(socket.id);
      socket.emit('stream_status', { status: 'stopped', message: 'Stream stopped by user' });
    }
  });
  
  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);
    if (ffmpegProcesses.has(socket.id)) {
      const ffmpeg = ffmpegProcesses.get(socket.id);
      console.log(`Cleaning up FFmpeg for disconnected client ${socket.id}`);
      try {
        ffmpeg.stdin.end();
        ffmpeg.kill('SIGINT');
      } catch (error) {
        console.error(`Error during cleanup: ${error.message}`);
      }
      ffmpegProcesses.delete(socket.id);
    }
    viewerCounts.delete(socket.id);
    platformChats.delete(socket.id);
  });
});

// Handle process termination
process.on('SIGINT', () => {
  console.log('Shutting down server...');
  for (const [socketId, ffmpeg] of ffmpegProcesses.entries()) {
    console.log(`Terminating FFmpeg for ${socketId}`);
    try {
      ffmpeg.stdin.end();
      ffmpeg.kill('SIGINT');
    } catch (error) {
      console.error(`Error terminating FFmpeg: ${error.message}`);
    }
  }
  setTimeout(() => {
    console.log('Exiting...');
    process.exit(0);
  }, 1000);
});

// Start the server
server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});