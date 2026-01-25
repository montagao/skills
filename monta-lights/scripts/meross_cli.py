#!/usr/bin/env python3
import argparse
import asyncio
import os
import sys

from meross_iot.http_api import MerossHttpClient
from meross_iot.manager import MerossManager


async def get_manager():
    email = os.environ.get("MEROSS_EMAIL")
    password = os.environ.get("MEROSS_PASSWORD")

    if not email or not password:
        print("Error: MEROSS_EMAIL and MEROSS_PASSWORD environment variables required")
        sys.exit(1)

    http = await MerossHttpClient.async_from_user_password(
        email=email, password=password, api_base_url="https://iot.meross.com"
    )
    mgr = MerossManager(http_client=http)
    await mgr.async_init()
    await mgr.async_device_discovery()
    return mgr, http


async def cleanup(mgr, http):
    mgr.close()
    await http.async_logout()


async def list_devices():
    mgr, http = await get_manager()
    devices = mgr.find_devices()

    if not devices:
        print("No devices found")
    else:
        print(f"Found {len(devices)} device(s):\n")
        for d in devices:
            await d.async_update()
            status = "ON" if d.is_on() else "OFF"
            print(f"  {d.name}")
            print(f"    UUID: {d.uuid}")
            print(f"    Type: {d.type}")
            print(f"    Status: {status}")
            print()

    await cleanup(mgr, http)


async def turn_all(on: bool):
    mgr, http = await get_manager()
    devices = mgr.find_devices()

    if not devices:
        print("No devices found")
        await cleanup(mgr, http)
        return

    action = "on" if on else "off"
    print(f"Turning {action} {len(devices)} device(s)...")

    for d in devices:
        await d.async_update()
        if on:
            await d.async_turn_on(channel=0)
        else:
            await d.async_turn_off(channel=0)
        print(f"  {d.name}: {action.upper()}")

    print("Done!")
    await cleanup(mgr, http)


async def control_device(uuid: str, on: bool):
    mgr, http = await get_manager()
    devices = mgr.find_devices(device_uuids=[uuid])

    if not devices:
        print(f"Device with UUID '{uuid}' not found")
        await cleanup(mgr, http)
        sys.exit(1)

    d = devices[0]
    await d.async_update()

    action = "on" if on else "off"
    if on:
        await d.async_turn_on(channel=0)
    else:
        await d.async_turn_off(channel=0)

    print(f"{d.name}: {action.upper()}")
    await cleanup(mgr, http)


def main():
    parser = argparse.ArgumentParser(
        description="Control Meross smart plugs",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  meross_cli.py list              List all devices and their status
  meross_cli.py on                Turn all devices on
  meross_cli.py off               Turn all devices off
  meross_cli.py on --uuid UUID    Turn specific device on
  meross_cli.py off --uuid UUID   Turn specific device off

Environment variables:
  MEROSS_EMAIL     Your Meross account email
  MEROSS_PASSWORD  Your Meross account password
"""
    )

    subparsers = parser.add_subparsers(dest="command", help="Command to run")

    # List command
    subparsers.add_parser("list", help="List all devices")

    # On command
    on_parser = subparsers.add_parser("on", help="Turn device(s) on")
    on_parser.add_argument("--uuid", "-u", help="Specific device UUID (default: all devices)")

    # Off command
    off_parser = subparsers.add_parser("off", help="Turn device(s) off")
    off_parser.add_argument("--uuid", "-u", help="Specific device UUID (default: all devices)")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    # Suppress library logs
    import logging
    logging.getLogger().setLevel(logging.ERROR)

    if args.command == "list":
        asyncio.run(list_devices())
    elif args.command == "on":
        if args.uuid:
            asyncio.run(control_device(args.uuid, on=True))
        else:
            asyncio.run(turn_all(on=True))
    elif args.command == "off":
        if args.uuid:
            asyncio.run(control_device(args.uuid, on=False))
        else:
            asyncio.run(turn_all(on=False))


if __name__ == "__main__":
    main()
