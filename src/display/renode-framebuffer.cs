using System.IO;
using System.Net;
using System.Net.Sockets;
using ELFSharp.ELF;
using Antmicro.Renode.Backends.Display;
using Antmicro.Renode.Core;
using Antmicro.Renode.Peripherals;
using Antmicro.Renode.Peripherals.Video;

namespace Antmicro.Renode.Peripherals.Miscellaneous
{
    // Taps an existing video peripheral: every rendered frame is converted to
    // RGBA8888 (the same conversion the GUI analyzer / FrameBufferTester do)
    // and streamed to the extension over a loopback socket as
    // [width u32][height u32][byteLength u32] little-endian, then pixels.
    //
    // Registered with no bus mapping (@ none); the video peripheral is passed
    // in by reference from the overlay .repl.
    public sealed class MinuteFramebuffer : IPeripheral
    {
        private readonly Stream stream;
        private IPixelConverter converter;
        private int width;
        private int height;
        private bool broken;

        public MinuteFramebuffer(IVideo video, int port)
        {
            var client = new TcpClient { NoDelay = true };
            client.Connect(IPAddress.Loopback, port);
            stream = client.GetStream();

            video.ConfigurationChanged += OnConfigurationChanged;
            video.FrameRendered += OnFrameRendered;
        }

        public void Reset() { }

        private void OnConfigurationChanged(int w, int h, PixelFormat format, Endianess endianess)
        {
            width = w;
            height = h;
            converter = PixelManipulationTools.GetConverter(format, endianess, PixelFormat.RGBA8888, Endianess.BigEndian);
        }

        private void OnFrameRendered(byte[] frame)
        {
            if(converter == null || broken)
            {
                return;
            }

            var pixels = new byte[width * height * 4];
            converter.Convert(frame, ref pixels);

            var header = new byte[12];
            Pack(header, 0, width);
            Pack(header, 4, height);
            Pack(header, 8, pixels.Length);

            try
            {
                stream.Write(header, 0, header.Length);
                stream.Write(pixels, 0, pixels.Length);
                stream.Flush();
            }
            catch
            {
                // Extension/webview went away first - stop touching the socket
                // so we never throw on Renode's render thread.
                broken = true;
            }
        }

        private static void Pack(byte[] buffer, int offset, int value)
        {
            buffer[offset] = (byte)value;
            buffer[offset + 1] = (byte)(value >> 8);
            buffer[offset + 2] = (byte)(value >> 16);
            buffer[offset + 3] = (byte)(value >> 24);
        }
    }
}
