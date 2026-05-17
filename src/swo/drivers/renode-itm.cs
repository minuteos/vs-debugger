using System.IO;
using System.Net;
using System.Net.Sockets;
using Antmicro.Renode.Peripherals;
using Antmicro.Renode.Peripherals.Bus;

namespace Antmicro.Renode.Peripherals.Miscellaneous
{
    // Synthetic ITM stimulus block. Each stimulus-port write becomes a framed
    // ITM source packet: header = (channel << 3) | sizeCode, then the
    // little-endian payload, streamed to the debugger over a loopback socket.
    // Control-register reads report ITM as enabled so the firmware emits even
    // though Renode never "really" enabled it.
    public sealed class MinuteItmCapture : IBytePeripheral, IWordPeripheral, IDoubleWordPeripheral, IKnownSize
    {
        private const long StimulusLimit = 0x80;
        private const long ItmTcr = 0xE80;
        private const long ItmTer = 0xE00;

        private readonly Stream stream;

        public MinuteItmCapture(int port)
        {
            var client = new TcpClient { NoDelay = true };
            client.Connect(IPAddress.Loopback, port);
            stream = client.GetStream();
        }

        public long Size => 0x1000;

        public void Reset() { }

        public void WriteByte(long offset, byte value) => Emit(offset, value, 1);
        public void WriteWord(long offset, ushort value) => Emit(offset, value, 2);
        public void WriteDoubleWord(long offset, uint value) => Emit(offset, value, 4);

        public byte ReadByte(long offset) => (byte)Read(offset);
        public ushort ReadWord(long offset) => (ushort)Read(offset);
        public uint ReadDoubleWord(long offset) => Read(offset);

        // FIFO always ready; ITM_TCR/TER read back enabled so the firmware emits.
        private static uint Read(long offset) =>
            offset < StimulusLimit ? 1u :
            offset == ItmTcr ? 1u :
            offset == ItmTer ? 0xFFFFFFFFu : 0u;

        private void Emit(long offset, uint value, int width)
        {
            if (offset >= StimulusLimit)
            {
                return;   // control-register writes are absorbed
            }

            var channel = (int)(offset >> 2);
            var sizeCode = width == 4 ? 3 : width;
            var packet = new byte[1 + width];
            packet[0] = (byte)((channel << 3) | sizeCode);
            for (var i = 0; i < width; i++)
            {
                packet[i + 1] = (byte)(value >> (8 * i));
            }
            stream.Write(packet, 0, packet.Length);
            stream.Flush();
        }
    }

    // Minimal CoreSight ROM table. detectPeripherals() (src/gdb/cortex.ts)
    // reads 0xE00FF000 to locate SCS/DWT/ITM/TPIU; pointing all four at
    // 0xE0000000 keeps setupTrace()'s register writes inside the absorbing
    // ITM overlay. Entry 0xFFF01001 resolves to 0xE0000000 with the present
    // bit set.
    public sealed class MinuteRomTable : IBytePeripheral, IWordPeripheral, IDoubleWordPeripheral, IKnownSize
    {
        private const uint PresentEntry = 0xFFF01001;

        public long Size => 0x1000;

        public void Reset() { }

        // SCS (0), DWT (4), ITM (12), TPIU (16) -> 0xE0000000; rest absent.
        public uint ReadDoubleWord(long offset) =>
            offset == 0 || offset == 4 || offset == 12 || offset == 16 ? PresentEntry : 0u;

        public ushort ReadWord(long offset) => (ushort)(ReadDoubleWord(offset & ~3L) >> (int)((offset & 2) * 8));
        public byte ReadByte(long offset) => (byte)(ReadDoubleWord(offset & ~3L) >> (int)((offset & 3) * 8));

        public void WriteByte(long offset, byte value) { }
        public void WriteWord(long offset, ushort value) { }
        public void WriteDoubleWord(long offset, uint value) { }
    }
}
