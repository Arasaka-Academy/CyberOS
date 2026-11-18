/**
 * [INPUT]: 动态加载 libasound，只读枚举指定声卡的 PCM ELD 控制项。
 * [OUTPUT]: 返回带 device/subdevice 身份和有效性的 ELD 证据。
 * [POS]: audio_route 的 Linux FFI 边界；不链接 macOS ALSA。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
use std::ffi::{CStr, CString, c_char, c_int, c_uint, c_void};
use std::ptr;

use nix::libc;

use super::{Eld, valid_eld};

type Handle = *mut c_void;

struct Library(Handle);

impl Drop for Library {
    fn drop(&mut self) {
        // SAFETY: this handle was returned by dlopen and stays owned until here.
        unsafe { libc::dlclose(self.0) };
    }
}

macro_rules! alsa_api {
    ($($name:ident: $ty:ty),+ $(,)?) => {
        struct Alsa { $($name: $ty,)+ _library: Library }
        impl Alsa {
            fn load() -> Option<Self> {
                // SAFETY: the library name is NUL-terminated and RTLD_LOCAL avoids global symbols.
                let library = Library(unsafe { libc::dlopen(c"libasound.so.2".as_ptr(), libc::RTLD_NOW | libc::RTLD_LOCAL) });
                if library.0.is_null() { return None; }
                $(
                    let symbol = CString::new(stringify!($name)).ok()?;
                    // SAFETY: dlsym reads a NUL-terminated symbol from the live library.
                    let address = unsafe { libc::dlsym(library.0, symbol.as_ptr()) };
                    if address.is_null() { return None; }
                    // SAFETY: these signatures match the stable ALSA C API. The owned library outlives each call.
                    let $name: $ty = unsafe { std::mem::transmute(address) };
                )+
                Some(Self { $($name,)+ _library: library })
            }
        }
    };
}

alsa_api! {
    snd_ctl_open: unsafe extern "C" fn(*mut Handle, *const c_char, c_int) -> c_int,
    snd_ctl_close: unsafe extern "C" fn(Handle) -> c_int,
    snd_ctl_elem_list_malloc: unsafe extern "C" fn(*mut Handle) -> c_int,
    snd_ctl_elem_list_free: unsafe extern "C" fn(Handle),
    snd_ctl_elem_list: unsafe extern "C" fn(Handle, Handle) -> c_int,
    snd_ctl_elem_list_alloc_space: unsafe extern "C" fn(Handle, c_uint) -> c_int,
    snd_ctl_elem_list_free_space: unsafe extern "C" fn(Handle),
    snd_ctl_elem_list_get_count: unsafe extern "C" fn(Handle) -> c_uint,
    snd_ctl_elem_list_get_used: unsafe extern "C" fn(Handle) -> c_uint,
    snd_ctl_elem_list_get_name: unsafe extern "C" fn(Handle, c_uint) -> *const c_char,
    snd_ctl_elem_list_get_interface: unsafe extern "C" fn(Handle, c_uint) -> c_int,
    snd_ctl_elem_list_get_device: unsafe extern "C" fn(Handle, c_uint) -> c_uint,
    snd_ctl_elem_list_get_subdevice: unsafe extern "C" fn(Handle, c_uint) -> c_uint,
    snd_ctl_elem_list_get_numid: unsafe extern "C" fn(Handle, c_uint) -> c_uint,
    snd_ctl_elem_info_malloc: unsafe extern "C" fn(*mut Handle) -> c_int,
    snd_ctl_elem_info_free: unsafe extern "C" fn(Handle),
    snd_ctl_elem_info_set_numid: unsafe extern "C" fn(Handle, c_uint),
    snd_ctl_elem_info: unsafe extern "C" fn(Handle, Handle) -> c_int,
    snd_ctl_elem_info_get_type: unsafe extern "C" fn(Handle) -> c_int,
    snd_ctl_elem_info_get_count: unsafe extern "C" fn(Handle) -> c_uint,
    snd_ctl_elem_value_malloc: unsafe extern "C" fn(*mut Handle) -> c_int,
    snd_ctl_elem_value_free: unsafe extern "C" fn(Handle),
    snd_ctl_elem_value_set_numid: unsafe extern "C" fn(Handle, c_uint),
    snd_ctl_elem_read: unsafe extern "C" fn(Handle, Handle) -> c_int,
    snd_ctl_elem_value_get_byte: unsafe extern "C" fn(Handle, c_uint) -> u8,
}

struct Allocation {
    ptr: Handle,
    free: unsafe extern "C" fn(Handle),
}

impl Allocation {
    fn new(
        alloc: unsafe extern "C" fn(*mut Handle) -> c_int,
        free: unsafe extern "C" fn(Handle),
    ) -> Option<Self> {
        let mut ptr = ptr::null_mut();
        // SAFETY: the allocator writes an opaque ALSA object into the owned pointer.
        if unsafe { alloc(&mut ptr) } < 0 || ptr.is_null() {
            return None;
        }
        Some(Self { ptr, free })
    }
}

impl Drop for Allocation {
    fn drop(&mut self) {
        // SAFETY: the matching allocator created this uniquely owned object.
        unsafe { (self.free)(self.ptr) };
    }
}

struct Control<'a> {
    ptr: Handle,
    api: &'a Alsa,
}
impl Drop for Control<'_> {
    fn drop(&mut self) {
        // SAFETY: the control was opened successfully and remains uniquely owned.
        unsafe { (self.api.snd_ctl_close)(self.ptr) };
    }
}

struct ListSpace<'a> {
    ptr: Handle,
    api: &'a Alsa,
}
impl Drop for ListSpace<'_> {
    fn drop(&mut self) {
        // SAFETY: space was allocated for this still-live list object.
        unsafe { (self.api.snd_ctl_elem_list_free_space)(self.ptr) };
    }
}

pub(super) fn eld_controls(card: u32) -> Option<Vec<Eld>> {
    let api = Alsa::load()?;
    let name = CString::new(format!("hw:{card}")).ok()?;
    let mut ptr = ptr::null_mut();
    // SAFETY: name is NUL-terminated; SND_CTL_READONLY (1) forbids hardware writes.
    if unsafe { (api.snd_ctl_open)(&mut ptr, name.as_ptr(), 1) } < 0 || ptr.is_null() {
        return None;
    }
    let control = Control { ptr, api: &api };
    let list = Allocation::new(api.snd_ctl_elem_list_malloc, api.snd_ctl_elem_list_free)?;
    let info = Allocation::new(api.snd_ctl_elem_info_malloc, api.snd_ctl_elem_info_free)?;
    let value = Allocation::new(api.snd_ctl_elem_value_malloc, api.snd_ctl_elem_value_free)?;
    // SAFETY: all handles refer to live objects of the correct ALSA type; the control is read-only.
    unsafe {
        if (api.snd_ctl_elem_list)(control.ptr, list.ptr) < 0 {
            return None;
        }
        let count = (api.snd_ctl_elem_list_get_count)(list.ptr);
        if count > 16384 || (api.snd_ctl_elem_list_alloc_space)(list.ptr, count) < 0 {
            return None;
        }
        let _space = ListSpace {
            ptr: list.ptr,
            api: &api,
        };
        if (api.snd_ctl_elem_list)(control.ptr, list.ptr) < 0
            || (api.snd_ctl_elem_list_get_used)(list.ptr) != count
        {
            return None;
        }
        let mut controls = Vec::new();
        for index in 0..count {
            let name = (api.snd_ctl_elem_list_get_name)(list.ptr, index);
            if name.is_null() {
                return None;
            }
            // ALSA PCM interface is 3. Names alone never prove the endpoint.
            if CStr::from_ptr(name).to_bytes() != b"ELD"
                || (api.snd_ctl_elem_list_get_interface)(list.ptr, index) != 3
            {
                continue;
            }
            let numid = (api.snd_ctl_elem_list_get_numid)(list.ptr, index);
            (api.snd_ctl_elem_info_set_numid)(info.ptr, numid);
            (api.snd_ctl_elem_value_set_numid)(value.ptr, numid);
            if (api.snd_ctl_elem_info)(control.ptr, info.ptr) < 0
                || (api.snd_ctl_elem_info_get_type)(info.ptr) != 4
                || (api.snd_ctl_elem_read)(control.ptr, value.ptr) < 0
            {
                return None;
            }
            let bytes = (api.snd_ctl_elem_info_get_count)(info.ptr);
            if bytes > 512 {
                return None;
            }
            let bytes: Vec<u8> = (0..bytes)
                .map(|offset| (api.snd_ctl_elem_value_get_byte)(value.ptr, offset))
                .collect();
            controls.push(Eld {
                device: (api.snd_ctl_elem_list_get_device)(list.ptr, index),
                subdevice: (api.snd_ctl_elem_list_get_subdevice)(list.ptr, index),
                valid: valid_eld(&bytes),
            });
        }
        Some(controls)
    }
}
