#!/usr/bin/env python3
"""Check if the current mouse cursor is a text/I-beam cursor. Prints TEXT or NONE."""
import ctypes, ctypes.util, sys

x11 = ctypes.cdll.LoadLibrary(ctypes.util.find_library('X11'))
xfixes = ctypes.cdll.LoadLibrary(ctypes.util.find_library('Xfixes'))

x11.XOpenDisplay.restype = ctypes.c_void_p

class XFixesCursorImage(ctypes.Structure):
    _fields_ = [
        ('x', ctypes.c_short), ('y', ctypes.c_short),
        ('width', ctypes.c_ushort), ('height', ctypes.c_ushort),
        ('xhot', ctypes.c_ushort), ('yhot', ctypes.c_ushort),
        ('cursor_serial', ctypes.c_ulong),
        ('pixels', ctypes.POINTER(ctypes.c_ulong)),
        ('atom', ctypes.c_ulong),
        ('name', ctypes.c_char_p),
    ]

xfixes.XFixesGetCursorImage.restype = ctypes.POINTER(XFixesCursorImage)

dpy = x11.XOpenDisplay(None)
if not dpy:
    print('NONE')
    sys.exit(0)

img = xfixes.XFixesGetCursorImage(dpy)
name = img.contents.name.decode('utf-8', errors='ignore').lower() if img.contents.name else ''
x11.XCloseDisplay(dpy)

# Text cursor names: xterm, ibeam, text
if any(n in name for n in ('xterm', 'ibeam', 'text')):
    print('TEXT')
else:
    print('NONE')
