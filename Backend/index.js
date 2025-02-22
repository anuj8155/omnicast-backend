const http = require("http");
const express = require("express");
const SocketIO = require("socket.io").Server;
const { spawn } = require("child_process");
const app = express();
const server = http.createServer(app);
const io = new SocketIO(server, { cors: { origin: "*" } });
const port = process.env.PORT || 4000;

// Track FFmpeg processes by socket ID
let ffmpegProcesses = new Map();

// Function to start FFmpeg for multiple RTMP URLs
const startFFmpeg = (urls, socketId) => {
  // Kill any existing FFmpeg process for this socket
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
    // Create output arguments for each RTMP URL
    const outputArgs = [];
    
    urls.forEach(url => {
      outputArgs.push('-f', 'flv', url);
    });
    
    // Build FFmpeg command
    const args = [
      '-re',                // Real-time mode
      '-i', 'pipe:0',       // Read from stdin
      '-c:v', 'libx264',    // Video codec
      '-preset', 'veryfast',
      '-tune', 'zerolatency',
      '-b:v', '1000k',      // Video bitrate
      '-maxrate', '1000k',
      '-bufsize', '2000k',
      '-g', '30',           // Keyframe interval
      '-r', '30',           // Framerate
      '-c:a', 'aac',        // Audio codec
      '-b:a', '128k',       // Audio bitrate
      '-ar', '44100',       // Audio sample rate
      '-f', 'tee',          // Use tee muxer for multiple outputs
      '-map', '0:v',        // Map video stream
      '-map', '0:a',        // Map audio stream
    ];
    
    // Create tee output format
    const teeOutputs = urls.map((url, index) => {
      return `[f=flv:onfail=ignore]${url}`;
    }).join('|');
    
    // Add tee output to args
    args.push(teeOutputs);
    
    console.log("FFmpeg command:", "ffmpeg", args.join(' '));
    
    // Spawn FFmpeg process
    const ffmpeg = spawn('ffmpeg', args);
    
    // Handle FFmpeg output for debugging
    ffmpeg.stderr.setEncoding('utf8');
    ffmpeg.stderr.on('data', (data) => {
      // Only log important FFmpeg messages to avoid console spam
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
    
    // Store the FFmpeg process
    ffmpegProcesses.set(socketId, ffmpeg);
    
    // Send confirmation to the client
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

// Socket connection handler
io.on("connection", (socket) => {
  console.log(`New client connected: ${socket.id}`);
  
  socket.on("set_rtmp_urls", (urls) => {
    console.log(`Received RTMP URLs from ${socket.id}:`, urls);
    startFFmpeg(urls, socket.id);
  });
  
  socket.on("binarystream", (chunk) => {
    const ffmpeg = ffmpegProcesses.get(socket.id);
    
    if (!ffmpeg) {
      console.log(`No FFmpeg process for ${socket.id}, ignoring stream data`);
      socket.emit('stream_status', {
        status: 'error',
        message: 'FFmpeg not running'
      });
      return;
    }
    
    try {
      // Write the chunk to FFmpeg's stdin
      const success = ffmpeg.stdin.write(chunk);
      
      if (!success) {
        console.log(`Buffer full for ${socket.id}, waiting for drain`);
        ffmpeg.stdin.once('drain', () => {
          console.log(`Buffer drained for ${socket.id}`);
        });
      }
    } catch (error) {
      console.error(`Error writing to FFmpeg: ${error.message}`);
      socket.emit('stream_status', {
        status: 'error',
        message: `Stream write error: ${error.message}`
      });
    }
  });
  
  socket.on("stop_streaming", () => {
    console.log(`Stop streaming requested by ${socket.id}`);
    
    if (ffmpegProcesses.has(socket.id)) {
      const ffmpeg = ffmpegProcesses.get(socket.id);
      console.log(`Stopping FFmpeg for ${socket.id}`);
      
      try {
        ffmpeg.stdin.end();  // Close stdin gracefully
        setTimeout(() => {
          if (ffmpegProcesses.has(socket.id)) {
            ffmpeg.kill('SIGKILL');  // Force kill if still running
          }
        }, 2000);
      } catch (error) {
        console.error(`Error stopping FFmpeg: ${error.message}`);
      }
      
      ffmpegProcesses.delete(socket.id);
      socket.emit('stream_status', {
        status: 'stopped',
        message: 'Stream stopped by user'
      });
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
  });
});

// Handle process termination
process.on('SIGINT', () => {
  console.log('Shutting down server...');
  
  // Terminate all FFmpeg processes
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