import { useEffect, useState } from "react";
import { db } from "./firebase";
import { ref, onValue, set, runTransaction } from "firebase/database";
import toast from "react-hot-toast";
import ScheduleTable from "./ScheduleTable";

const MAX_PEOPLE = 3;

// Hàm mã hóa mật khẩu bằng SHA-256
const hashPassword = async (password) => {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
};

// Hàm tạo danh sách tuần
const generateWeeks = () => {
  const weeks = [];
  const today = new Date();

  // Tạo 8 tuần: 2 tuần trước, tuần hiện tại, và 5 tuần sau
  for (let i = -2; i <= 5; i++) {
    const startDate = new Date(today);
    const dayOfWeek = today.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Chủ nhật = 0, Thứ 2 = 1
    startDate.setDate(today.getDate() + mondayOffset + i * 7);

    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 6);

    const weekId = `week-${startDate.getFullYear()}-${String(
      startDate.getMonth() + 1
    ).padStart(2, "0")}-${String(startDate.getDate()).padStart(2, "0")}`;

    weeks.push({
      id: weekId,
      label: `${startDate.getDate()}/${
        startDate.getMonth() + 1
      } - ${endDate.getDate()}/${
        endDate.getMonth() + 1
      }/${endDate.getFullYear()}`,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      isCurrent: i === 0,
    });
  }

  return weeks;
};

const AVAILABLE_WEEKS = generateWeeks();

// Hàm tạo DAYS cho tuần được chọn
const generateDaysForWeek = (weekData) => {
  const days = [];
  const dayNames = [
    "Chủ nhật",
    "Thứ 2",
    "Thứ 3",
    "Thứ 4",
    "Thứ 5",
    "Thứ 6",
    "Thứ 7",
  ];

  for (let i = 0; i < 7; i++) {
    const date = new Date(weekData.startDate);
    date.setDate(weekData.startDate.getDate() + i);

    let dayName = dayNames[date.getDay()];
    if (date.getDay() === 0) {
      // Chủ nhật
      dayName = "Chủ nhật";
    }

    days.push({
      name: dayName,
      date: `${String(date.getDate()).padStart(2, "0")}/${String(
        date.getMonth() + 1
      ).padStart(2, "0")}`,
    });
  }

  return days;
};

const SHIFTS = [
  { name: "Ca 1", time: "08:00 - 13:00" },
  { name: "Ca 2", time: "12:00 - 18:00" },
  { name: "Ca 3", time: "17:00 - 22:00" },
];

function App() {
  const [employees, setEmployees] = useState([]);
  const [selectedName, setSelectedName] = useState(() => {
    // Khôi phục nhân viên đã chọn từ localStorage
    return localStorage.getItem("selectedEmployee") || "";
  });
  const [shifts, setShifts] = useState({});
  const [showScheduleTable, setShowScheduleTable] = useState(false);
  const [dailyRoles, setDailyRoles] = useState({});

  // Week selection states
  const [selectedWeek, setSelectedWeek] = useState(() => {
    // Mặc định là tuần hiện tại, sẽ được cập nhật từ Firebase
    return AVAILABLE_WEEKS.find((week) => week.isCurrent);
  });

  // Dynamic DAYS based on selected week
  const DAYS = generateDaysForWeek(selectedWeek);

  // Authentication states
  const [isSystemOpen, setIsSystemOpen] = useState(false); // Sẽ được sync từ Firebase
  const [isLoading, setIsLoading] = useState(true); // Loading state cho Firebase
  const [password, setPassword] = useState("");
  const [showPasswordInput, setShowPasswordInput] = useState(false);
  const [passwordMode, setPasswordMode] = useState(""); // "open", "close", "reset", "change", "manage-employees"
  const [showRestoreMessage, _setShowRestoreMessage] = useState(false);
  const [adminPasswordHash, setAdminPasswordHash] = useState(""); // Hash mật khẩu từ Firebase
  const [newPassword, setNewPassword] = useState(""); // Mật khẩu mới khi đổi mật khẩu
  const [confirmPassword, setConfirmPassword] = useState(""); // Xác nhận mật khẩu mới

  // Employee management states
  const [showEmployeeManagement, setShowEmployeeManagement] = useState(false);
  const [newEmployeeName, setNewEmployeeName] = useState("");
  const [editingIndex, setEditingIndex] = useState(-1);
  const [editingName, setEditingName] = useState("");

  // Khởi tạo dữ liệu shifts cho tất cả ngày và ca
  useEffect(() => {
    onValue(ref(db, "systemConfig/adminPasswordHash"), (snapshot) => {
      const hash = snapshot.val() || "";
      setAdminPasswordHash(hash);
    });

    // Lắng nghe dữ liệu employees
    onValue(ref(db, "employees"), (snapshot) => {
      const data = snapshot.val() || [];
      setEmployees(data);
    });

    // Lắng nghe trạng thái hệ thống từ Firebase
    onValue(ref(db, "systemStatus/isOpen"), (snapshot) => {
      const isOpen = snapshot.val() || false;
      setIsSystemOpen(isOpen);
      setTimeout(() => {
        setIsLoading(false); // Đã load xong dữ liệu từ Firebase
      }, 1000);
    });

    // Lắng nghe tuần được chọn từ Firebase
    onValue(ref(db, "systemStatus/selectedWeek"), (snapshot) => {
      const weekId = snapshot.val();
      if (weekId) {
        const week = AVAILABLE_WEEKS.find((w) => w.id === weekId);
        if (week) {
          setSelectedWeek(week);
        }
      }
    });

    // Lắng nghe dữ liệu vai trò hàng ngày
    onValue(ref(db, `dailyRoles/${selectedWeek.id}`), (snapshot) => {
      const data = snapshot.val() || {};
      setDailyRoles(data);
    });
  }, [selectedWeek.id]);

  // useEffect riêng cho shifts để tránh dependency loop
  useEffect(() => {
    // Lắng nghe dữ liệu shifts cho tuần đã chọn
    const unsubscribe = onValue(
      ref(db, `shifts/${selectedWeek.id}`),
      (snapshot) => {
        const data = snapshot.val() || {};
        // Khởi tạo cấu trúc mặc định nếu chưa có
        const defaultShifts = {};
        DAYS.forEach((day, dayIndex) => {
          SHIFTS.forEach((shift, shiftIndex) => {
            const key = `day${dayIndex}-shift${shiftIndex}`;
            defaultShifts[key] = [];
          });
        });
        setShifts({ ...defaultShifts, ...data });
      }
    );

    return () => unsubscribe();
  }, [selectedWeek.id, DAYS]);

  // Lưu selectedName vào localStorage khi thay đổi
  useEffect(() => {
    if (selectedName) {
      localStorage.setItem("selectedEmployee", selectedName);
    } else {
      localStorage.removeItem("selectedEmployee");
    }
  }, [selectedName]);

  // Notification function - chỉ hiển thị lỗi và cảnh báo
  const showNotification = (message, type = "info") => {
    // Skip success notifications
    if (type === "success") {
      return;
    }

    switch (type) {
      case "error":
        toast.error(message);
        break;
      case "warning":
        toast(message, {
          icon: "⚠️",
          style: {
            borderLeft: "4px solid #f59e0b",
          },
        });
        break;
      case "info":
      default:
        toast(message, {
          icon: "ℹ️",
          style: {
            borderLeft: "4px solid #3b82f6",
          },
        });
        break;
    }
  };

  const handleRegister = async (dayIndex, shiftIndex) => {
    if (!selectedName) {
      showNotification("Hãy chọn tên trước!", "warning");
      return;
    }

    const key = `day${dayIndex}-shift${shiftIndex}`;
    const shiftRef = ref(db, `shifts/${selectedWeek.id}/${key}`);

    try {
      await runTransaction(shiftRef, (currentData) => {
        const current = currentData || [];

        // Kiểm tra xem user đã đăng ký chưa
        if (current.includes(selectedName)) {
          // User đã đăng ký - không thay đổi gì, trả về data cũ
          return current;
        }

        // Kiểm tra xem ca đã full chưa (race condition protection)
        if (current.length >= MAX_PEOPLE) {
          // Ca đã đủ người - không thay đổi gì, trả về data cũ
          return current;
        }

        // Thêm user vào danh sách - transaction đảm bảo atomic
        // Ai click trước thì được vào trước (first-come-first-served)
        return [...current, selectedName];
      });

      // Transaction thành công - UI sẽ tự update từ Firebase listener
    } catch {
      // Transaction failed - có thể do network hoặc lỗi khác
      showNotification("Có lỗi xảy ra, vui lòng thử lại!", "error");
    }
  };

  const handleCancel = async (dayIndex, shiftIndex) => {
    console.log("🚫 Cancel clicked", { dayIndex, shiftIndex, selectedName });

    if (!selectedName) {
      showNotification("Hãy chọn tên trước!", "warning");
      return;
    }

    const key = `day${dayIndex}-shift${shiftIndex}`;
    const shiftRef = ref(db, `shifts/${selectedWeek.id}/${key}`);

    console.log("🚫 Starting cancel transaction", {
      key,
      selectedWeek: selectedWeek.id,
    });

    try {
      await runTransaction(shiftRef, (currentData) => {
        const current = currentData || [];
        console.log("🚫 Transaction data:", {
          current,
          selectedName,
          includes: current.includes(selectedName),
        });

        // Đơn giản hóa: chỉ filter user ra khỏi list
        // Nếu user không có trong list thì filter vẫn trả về list cũ (không thay đổi gì)
        const newList = current.filter((name) => name !== selectedName);

        console.log("🚫 Filtered list:", {
          original: current,
          filtered: newList,
        });

        // Luôn return newList, Firebase sẽ tự động so sánh và chỉ update nếu có thay đổi
        return newList;
      });

      console.log("🚫 Cancel transaction completed");
    } catch (error) {
      console.log("🚫 Cancel transaction failed:", error);
      // Chỉ hiển thị lỗi khi có network issues hoặc lỗi thật sự
      showNotification("Có lỗi xảy ra, vui lòng thử lại!", "error");
    }
  };

  const handleEmployeeChange = (e) => {
    setSelectedName(e.target.value);
  };

  const handleClearSelection = () => {
    setSelectedName("");
    localStorage.removeItem("selectedEmployee");
  };

  const handleWeekChange = (e) => {
    const weekId = e.target.value;
    console.log('Selected week ID:', weekId); // Debug log
    const week = AVAILABLE_WEEKS.find((w) => w.id === weekId);
    console.log('Found week:', week); // Debug log
    if (week) {
      setSelectedWeek(week);
      // Cập nhật Firebase để đồng bộ với tất cả clients
      set(ref(db, "systemStatus/selectedWeek"), weekId);
      console.log('Week changed to:', week); // Debug log
    } else {
      console.error('Week not found for ID:', weekId);
    }
  };

  const getShiftData = (dayIndex, shiftIndex) => {
    const key = `day${dayIndex}-shift${shiftIndex}`;
    const data = shifts[key] || [];
    return data;
  };

  const isShiftFull = (dayIndex, shiftIndex) => {
    return getShiftData(dayIndex, shiftIndex).length >= MAX_PEOPLE;
  };

  const isUserRegistered = (dayIndex, shiftIndex) => {
    const shiftData = getShiftData(dayIndex, shiftIndex);
    const isRegistered = selectedName && shiftData.includes(selectedName);
    return isRegistered;
  };

  // Render tên với vai trò
  const renderNameWithRole = (name, dayIndex, shiftIndex) => {
    const dayKey = `day${dayIndex}`;
    const dayRoles = dailyRoles[dayKey];
    
    if (!dayRoles) return name;
    
    let displayName = name;
    const roles = [];
    
    // Kiểm tra key (chỉ ở Ca 1)
    if (shiftIndex === 0 && dayRoles.keyKeeper === name) {
      roles.push("key");
    }
    
    // Kiểm tra két (theo từng ca)
    if (dayRoles.ketKeepers && typeof dayRoles.ketKeepers === 'object') {
      const shiftKey = `shift${shiftIndex}`;
      if (dayRoles.ketKeepers[shiftKey] === name) {
        roles.push("két");
      }
    } else if (Array.isArray(dayRoles.ketKeepers) && dayRoles.ketKeepers.includes(name)) {
      // Fallback cho dữ liệu cũ
      roles.push("két");
    }
    
    if (roles.length > 0) {
      displayName += ` (${roles.join(', ')})`;
    }
    
    return displayName;
  };

  // Authentication handlers
  const handleOpenSystem = () => {
    setShowPasswordInput(true);
    setPasswordMode("open");
  };

  const handleCloseSystem = () => {
    setShowPasswordInput(true);
    setPasswordMode("close");
  };

  const handleResetSchedule = () => {
    setShowPasswordInput(true);
    setPasswordMode("reset");
  };

  const handleChangePassword = () => {
    setShowPasswordInput(true);
    setPasswordMode("change");
    setPassword("");
    setNewPassword("");
    setConfirmPassword("");
  };

  const handleManageEmployees = () => {
    setShowPasswordInput(true);
    setPasswordMode("manage-employees");
    setPassword("");
  };

  // Employee management functions
  const handleAddEmployee = async () => {
    if (!newEmployeeName.trim()) {
      showNotification("Tên nhân viên không được để trống!", "error");
      return;
    }

    if (employees.includes(newEmployeeName.trim())) {
      showNotification("Nhân viên này đã tồn tại!", "error");
      return;
    }

    const updatedEmployees = [...employees, newEmployeeName.trim()];
    setEmployees(updatedEmployees);
    await set(ref(db, "employees"), updatedEmployees);
    setNewEmployeeName("");
    showNotification("Đã thêm nhân viên mới!", "success");
  };

  const handleEditEmployee = (index) => {
    setEditingIndex(index);
    setEditingName(employees[index]);
  };

  const handleSaveEdit = async () => {
    if (!editingName.trim()) {
      showNotification("Tên nhân viên không được để trống!", "error");
      return;
    }

    if (employees.includes(editingName.trim()) && editingName.trim() !== employees[editingIndex]) {
      showNotification("Tên nhân viên này đã tồn tại!", "error");
      return;
    }

    const oldName = employees[editingIndex];
    const newName = editingName.trim();
    
    // Cập nhật danh sách nhân viên
    const updatedEmployees = [...employees];
    updatedEmployees[editingIndex] = newName;
    setEmployees(updatedEmployees);
    await set(ref(db, "employees"), updatedEmployees);

    // Cập nhật tên trong lịch làm việc nếu có
    const currentShifts = { ...shifts };
    let hasChanges = false;
    
    Object.keys(currentShifts).forEach(key => {
      if (currentShifts[key].includes(oldName)) {
        const index = currentShifts[key].indexOf(oldName);
        currentShifts[key][index] = newName;
        hasChanges = true;
      }
    });

    if (hasChanges) {
      setShifts(currentShifts);
      await set(ref(db, `shifts/${selectedWeek.id}`), currentShifts);
    }

    // Cập nhật selectedName nếu đang chọn nhân viên này
    if (selectedName === oldName) {
      setSelectedName(newName);
    }

    setEditingIndex(-1);
    setEditingName("");
    showNotification("Đã cập nhật tên nhân viên!", "success");
  };

  const handleCancelEdit = () => {
    setEditingIndex(-1);
    setEditingName("");
  };

  const handleDeleteEmployee = async (index) => {
    const employeeName = employees[index];
    
    if (window.confirm(`Bạn có chắc muốn xóa nhân viên "${employeeName}"? Điều này sẽ xóa họ khỏi tất cả ca làm việc.`)) {
      // Xóa khỏi danh sách nhân viên
      const updatedEmployees = employees.filter((_, i) => i !== index);
      setEmployees(updatedEmployees);
      await set(ref(db, "employees"), updatedEmployees);

      // Xóa khỏi lịch làm việc
      const currentShifts = { ...shifts };
      let hasChanges = false;
      
      Object.keys(currentShifts).forEach(key => {
        if (currentShifts[key].includes(employeeName)) {
          currentShifts[key] = currentShifts[key].filter(name => name !== employeeName);
          hasChanges = true;
        }
      });

      if (hasChanges) {
        setShifts(currentShifts);
        await set(ref(db, `shifts/${selectedWeek.id}`), currentShifts);
      }

      // Clear selectedName nếu đang chọn nhân viên này
      if (selectedName === employeeName) {
        setSelectedName("");
      }

      showNotification("Đã xóa nhân viên!", "success");
    }
  };

  // Function tự động đăng ký Phương vào Ca 1 và Ca 2 cho tất cả ngày
  const autoRegisterPhuong = () => {
    const employeeName = "Phương";
    const updatedShifts = { ...shifts };
    
    // Duyệt qua tất cả ngày (0-6: Thứ 2 đến Chủ nhật)
    DAYS.forEach((day, dayIndex) => {
      // Đăng ký Ca 1 (shiftIndex = 0)
      const ca1Key = `day${dayIndex}-shift0`;
      if (!updatedShifts[ca1Key]) updatedShifts[ca1Key] = [];
      if (!updatedShifts[ca1Key].includes(employeeName)) {
        updatedShifts[ca1Key] = [...updatedShifts[ca1Key], employeeName];
      }
      
      // Đăng ký Ca 2 (shiftIndex = 1)
      const ca2Key = `day${dayIndex}-shift1`;
      if (!updatedShifts[ca2Key]) updatedShifts[ca2Key] = [];
      if (!updatedShifts[ca2Key].includes(employeeName)) {
        updatedShifts[ca2Key] = [...updatedShifts[ca2Key], employeeName];
      }
    });

    // Cập nhật state local
    setShifts(updatedShifts);
    
    // Lưu vào Firebase
    set(ref(db, `shifts/${selectedWeek.id}`), updatedShifts);
    
    showNotification(`Đã đăng ký ${employeeName} vào Ca 1 và Ca 2 cho tất cả ngày!`, "success");
  };

  const handlePasswordSubmit = async () => {
    try {
      if (passwordMode === "change") {
        // Logic đổi mật khẩu
        if (newPassword !== confirmPassword) {
          showNotification("Mật khẩu xác nhận không khớp!", "error");
          return;
        }
        
        if (newPassword.length < 6) {
          showNotification("Mật khẩu mới phải có ít nhất 6 ký tự!", "error");
          return;
        }

        // Kiểm tra mật khẩu cũ
        const inputPasswordHash = await hashPassword(password);
        if (inputPasswordHash !== adminPasswordHash) {
          showNotification("Mật khẩu cũ không chính xác!", "error");
          setPassword("");
          return;
        }

        // Hash mật khẩu mới và lưu vào Firebase
        const newPasswordHash = await hashPassword(newPassword);
        await set(ref(db, "systemConfig/adminPasswordHash"), newPasswordHash);
        
        showNotification("Đổi mật khẩu thành công!", "success");
        setShowPasswordInput(false);
        setPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setPasswordMode("");
        return;
      }
      
      // Logic xác thực mật khẩu cho các chức năng khác
      const inputPasswordHash = await hashPassword(password);
      
      if (inputPasswordHash === adminPasswordHash) {
        if (passwordMode === "open") {
          // Mở hệ thống và lưu tuần được chọn
          set(ref(db, "systemStatus/isOpen"), true);
          set(ref(db, "systemStatus/selectedWeek"), selectedWeek.id);
          showNotification("Hệ thống đã được mở!", "success");
        } else if (passwordMode === "close") {
          // Đóng hệ thống
          set(ref(db, "systemStatus/isOpen"), false);
          showNotification("Hệ thống đã được đóng!", "success");
        } else if (passwordMode === "reset") {
          // Reset lịch làm việc - xóa toàn bộ shifts cho tuần hiện tại
          const resetShifts = {};
          DAYS.forEach((day, dayIndex) => {
            SHIFTS.forEach((shift, shiftIndex) => {
              const key = `day${dayIndex}-shift${shiftIndex}`;
              resetShifts[key] = [];
            });
          });
          set(ref(db, `shifts/${selectedWeek.id}`), resetShifts);
          showNotification("Lịch làm việc đã được reset!", "success");
        } else if (passwordMode === "manage-employees") {
          // Mở modal quản lý nhân viên
          setShowEmployeeManagement(true);
          showNotification("Đã xác thực! Bạn có thể quản lý nhân viên.", "success");
        }
        setShowPasswordInput(false);
        setPassword("");
        setPasswordMode("");
      } else {
        showNotification("Mật khẩu không chính xác!", "error");
        setPassword("");
      }
    } catch (error) {
      console.error("Lỗi xác thực mật khẩu:", error);
      showNotification("Có lỗi xảy ra khi xác thực!", "error");
    }
  };

  const handleCancelPassword = () => {
    setShowPasswordInput(false);
    setPassword("");
    setPasswordMode("");
  };

  // Render loading screen khi đang load dữ liệu từ Firebase
  if (isLoading) {
    return (
      <div className="auth-container">
        <div className="auth-card loading-card">
          <h1>🔄 Đang Tải...</h1>
          <p>Đang kết nối với hệ thống</p>

          <div className="loading-animation">
            <div className="spinner"></div>
          </div>
        </div>
      </div>
    );
  }

  // Render password input screen
  if (showPasswordInput) {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <h1>🔐 Xác Thực</h1>
          <p>
            {passwordMode === "open"
              ? "Chọn tuần và nhập mật khẩu để mở hệ thống"
              : passwordMode === "close"
              ? "Nhập mật khẩu để đóng hệ thống"
              : passwordMode === "reset"
              ? "Nhập mật khẩu để reset toàn bộ lịch làm việc"
              : passwordMode === "manage-employees"
              ? "Nhập mật khẩu để quản lý danh sách nhân viên"
              : "Đổi mật khẩu quản trị"}
          </p>

          {passwordMode === "open" && (
            <div className="week-selector-auth">
              <label>📅 Chọn tuần để mở:</label>
              <select value={selectedWeek.id} onChange={handleWeekChange}>
                {AVAILABLE_WEEKS.map((week) => {
                  console.log('Rendering week option:', week); // Debug log
                  return (
                    <option key={week.id} value={week.id}>
                      {week.label} {week.isCurrent ? "(Tuần hiện tại)" : ""}
                    </option>
                  );
                })}
              </select>
              <p style={{marginTop: '10px', fontSize: '0.9rem', color: '#666'}}>
                Hiện tại đang chọn: {selectedWeek.label}
              </p>
            </div>
          )}

          <div className="password-input">
            {passwordMode === "change" ? (
              <>
                <input
                  type="password"
                  placeholder="Nhập mật khẩu cũ..."
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <input
                  type="password"
                  placeholder="Nhập mật khẩu mới..."
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
                <input
                  type="password"
                  placeholder="Xác nhận mật khẩu mới..."
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onKeyPress={(e) => e.key === "Enter" && handlePasswordSubmit()}
                />
              </>
            ) : (
              <input
                type="password"
                placeholder="Nhập mật khẩu..."
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyPress={(e) => e.key === "Enter" && handlePasswordSubmit()}
              />
            )}
            <button onClick={handlePasswordSubmit}>
              {passwordMode === "change" ? "Đổi mật khẩu" : "Xác nhận"}
            </button>
          </div>

          <button className="back-btn" onClick={handleCancelPassword}>
            ← Quay lại
          </button>
        </div>
      </div>
    );
  }

  // Nếu hệ thống đang đóng, hiển thị nút mở hệ thống
  if (!isSystemOpen) {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <h1>Đăng Ký Lịch Làm Việc</h1>
          <p>Hệ thống hiện đang đóng</p>

          {/* Hiển thị trạng thái hệ thống */}
          <div className="system-status closed">🔴 Hệ thống đang đóng</div>

          <div className="auth-buttons">
            <button className="auth-btn manager-btn" onClick={handleOpenSystem}>
              🔓 Mở Hệ Thống
            </button>
            <button className="auth-btn change-password-btn" onClick={handleChangePassword}>
              🔑 Đổi Mật Khẩu
            </button>
            {/* <button className="auth-btn manage-employees-btn" onClick={handleManageEmployees}>
              👥 Quản Lý Nhân Viên
            </button> */}
          </div>
        </div>
      </div>
    );
  }

  // Nếu hệ thống đã mở, hiển thị giao diện chính
  if (isSystemOpen) {
    return (
      <>
        {showScheduleTable && (
          <ScheduleTable
            setShowScheduleTable={setShowScheduleTable}
            selectedWeek={selectedWeek}
            DAYS={DAYS}
            SHIFTS={SHIFTS}
            getShiftData={getShiftData}
            MAX_PEOPLE={MAX_PEOPLE}
          />
        )}

        <div className="container">
          {/* Header với system controls */}
          <div className="app-header">
            <div className="header-left">
              <h1>📅 Đăng Ký Lịch Làm Việc</h1>
              <p>{selectedWeek.label}</p>
              <span className="role-badge">🟢 Hệ Thống Đang Hoạt Động</span>
            </div>

            <div className="header-right">
              {/* <button
                className="auto-register-btn"
                onClick={autoRegisterPhuong}
                title="Đăng ký Phương cho tất cả Ca 1 và Ca 2"
              >
                🚀 Đăng Ký Phương
              </button> */}
              <button
                className="manage-employees-btn"
                onClick={handleManageEmployees}
                title="Quản lý danh sách nhân viên"
              >
                👥 Quản Lý NV
              </button>
              <button
                className="view-schedule-btn"
                onClick={() => setShowScheduleTable(true)}
                title="Xem bảng lịch tổng thể"
              >
                📊 Xem Lịch
              </button>
              <button
                className="reset-btn"
                onClick={handleResetSchedule}
                title="Reset toàn bộ lịch làm việc"
              >
                🔄 Reset Lịch
              </button>
              <button
                className="system-control-btn"
                onClick={handleCloseSystem}
                title="Đóng hệ thống"
              >
                🔒 Đóng Hệ Thống
              </button>
            </div>
          </div>

          {showRestoreMessage && (
            <div className="restore-message">
              ✅ Đã khôi phục lựa chọn nhân viên: {selectedName}
            </div>
          )}

          <div className="content">
            <div className="employee-selector">
              <label>👤 Chọn nhân viên:</label>
              <div className="employee-controls">
                <select value={selectedName} onChange={handleEmployeeChange}>
                  <option value="">-- Chọn nhân viên --</option>
                  {employees.map((emp, index) => (
                    <option key={index} value={emp}>
                      {emp}
                    </option>
                  ))}
                </select>
                {selectedName && (
                  <button
                    className="clear-btn"
                    onClick={handleClearSelection}
                    title="Xóa lựa chọn"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            <div className="desktop-table">
              <div className="table-wrapper">
                <table className="schedule-table">
                  <thead>
                    <tr>
                      <th></th>
                      {DAYS.map((day, index) => (
                        <th key={index} className="day-header">
                          {day.name}
                          <br />
                          <small>{day.date}</small>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {SHIFTS.map((shift, shiftIndex) => (
                      <tr key={shiftIndex}>
                        <td>
                          <div>{shift.name}</div>
                          <small style={{ opacity: 0.7, fontSize: "0.8rem" }}>
                            {shift.time}
                          </small>
                        </td>
                        {DAYS.map((day, dayIndex) => {
                          const shiftData = getShiftData(dayIndex, shiftIndex);
                          const isFull = isShiftFull(dayIndex, shiftIndex);
                          const isRegistered = isUserRegistered(
                            dayIndex,
                            shiftIndex
                          );

                          return (
                            <td
                              key={dayIndex}
                              className={`shift-cell ${
                                shiftData.length > 0 ? "has-employees" : ""
                              } ${isFull ? "full" : ""} ${
                                isRegistered ? "registered" : ""
                              }`}
                            >
                              <div className="container-fluid">
                                <div className="employee-list">
                                  {shiftData.map((employee, empIndex) => (
                                    <span
                                      key={empIndex}
                                      className={`employee-tag ${
                                        employee === selectedName
                                          ? "current-user"
                                          : ""
                                      }`}
                                    >
                                      {renderNameWithRole(employee, dayIndex, shiftIndex)}
                                    </span>
                                  ))}
                                </div>
                                {(!isFull || isRegistered) && (
                                  <div className="box-btn">
                                    {isRegistered ? (
                                      <button
                                        className="cancel-btn"
                                        onClick={() =>
                                          handleCancel(dayIndex, shiftIndex)
                                        }
                                        disabled={!selectedName}
                                      >
                                        Hủy
                                      </button>
                                    ) : (
                                      <button
                                        className="register-btn"
                                        onClick={() =>
                                          handleRegister(dayIndex, shiftIndex)
                                        }
                                        disabled={!selectedName || isFull}
                                      >
                                        Đăng ký
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                              {/* <div
                                className={`shift-status ${
                                  isFull ? "status-full" : "status-available"
                                }`}
                              >
                                {shiftData.length}/{MAX_PEOPLE}
                              </div> */}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mobile Table Layout */}
            <div className="mobile-table">
              <div className="table-wrapper">
                <table className="mobile-schedule-table">
                  <thead>
                    <tr>
                      <th></th>
                      {SHIFTS.map((shift, index) => (
                        <th key={index} className="shift-header-mobile">
                          {shift.name}
                          <br />
                          <small>{shift.time}</small>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {DAYS.map((day, dayIndex) => (
                      <tr key={dayIndex}>
                        <td className="day-cell-mobile">
                          <div>{day.name}</div>
                          <small>{day.date}</small>
                        </td>
                        {SHIFTS.map((shift, shiftIndex) => {
                          const shiftData = getShiftData(dayIndex, shiftIndex);
                          const isFull = isShiftFull(dayIndex, shiftIndex);
                          const isRegistered = isUserRegistered(
                            dayIndex,
                            shiftIndex
                          );

                          return (
                            <td
                              key={shiftIndex}
                              className={`shift-cell-mobile ${
                                shiftData.length > 0 ? "has-employees" : ""
                              } ${isFull ? "full" : ""} ${
                                isRegistered ? "registered" : ""
                              }`}
                            >
                              <div className="container-fluid">
                                <div className="employee-list-mobile">
                                  {shiftData.map((employee, empIndex) => (
                                    <span
                                      key={empIndex}
                                      className={`employee-tag-mobile ${
                                        employee === selectedName
                                          ? "current-user"
                                          : ""
                                      }`}
                                    >
                                      {renderNameWithRole(employee, dayIndex, shiftIndex)}
                                    </span>
                                  ))}
                                </div>
                                {(!isFull || isRegistered) &&
                                  (isRegistered ? (
                                    <div className="box-btn-mobile">
                                      <button
                                        className="cancel-btn-mobile"
                                        onClick={() =>
                                          handleCancel(dayIndex, shiftIndex)
                                        }
                                        disabled={!selectedName}
                                      >
                                        x
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="box-btn-mobile">
                                      <button
                                        className="register-btn-mobile"
                                        onClick={() =>
                                          handleRegister(dayIndex, shiftIndex)
                                        }
                                        disabled={!selectedName || isFull}
                                      >
                                        +
                                      </button>
                                    </div>
                                  ))}
                              </div>
                              {/* <div
                                className={`shift-status-mobile ${
                                  isFull ? "status-full" : "status-available"
                                }`}
                              >
                                {shiftData.length}/{MAX_PEOPLE}
                              </div> */}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Employee Management Modal */}
          {showEmployeeManagement && (
            <div className="modal-overlay">
              <div className="modal-content employee-management-modal">
                <div className="modal-header">
                  <h2>👥 Quản Lý Nhân Viên</h2>
                  <button
                    className="modal-close-btn"
                    onClick={() => setShowEmployeeManagement(false)}
                  >
                    ✕
                  </button>
                </div>

                <div className="modal-body">
                  {/* Add new employee */}
                  <div className="add-employee-section">
                    <h3>➕ Thêm Nhân Viên Mới</h3>
                    <div className="add-employee-form">
                      <input
                        type="text"
                        placeholder="Nhập tên nhân viên..."
                        value={newEmployeeName}
                        onChange={(e) => setNewEmployeeName(e.target.value)}
                        onKeyPress={(e) => e.key === "Enter" && handleAddEmployee()}
                      />
                      <button className="add-btn" onClick={handleAddEmployee}>
                        Thêm
                      </button>
                    </div>
                  </div>

                  {/* Employee list */}
                  <div className="employee-list-section">
                    <h3>📋 Danh Sách Nhân Viên ({employees.length})</h3>
                    <div className="employee-management-list">
                      {employees.length === 0 ? (
                        <p className="no-employees">Chưa có nhân viên nào</p>
                      ) : (
                        employees.map((employee, index) => (
                          <div key={index} className="employee-item">
                            {editingIndex === index ? (
                              <div className="edit-employee-form">
                                <input
                                  type="text"
                                  value={editingName}
                                  onChange={(e) => setEditingName(e.target.value)}
                                  onKeyPress={(e) => {
                                    if (e.key === "Enter") handleSaveEdit();
                                    if (e.key === "Escape") handleCancelEdit();
                                  }}
                                  autoFocus
                                />
                                <div className="edit-buttons">
                                  <button className="save-btn" onClick={handleSaveEdit}>
                                    ✓
                                  </button>
                                  <button className="cancel-btn" onClick={handleCancelEdit}>
                                    ✕
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="employee-display">
                                <span className="employee-name">{employee}</span>
                                <div className="employee-actions">
                                  <button
                                    className="edit-btn"
                                    onClick={() => handleEditEmployee(index)}
                                    title="Sửa tên"
                                  >
                                    ✏️
                                  </button>
                                  <button
                                    className="delete-btn"
                                    onClick={() => handleDeleteEmployee(index)}
                                    title="Xóa nhân viên"
                                  >
                                    🗑️
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
         {/* <button
                className="auto-register-btn"
                onClick={autoRegisterPhuong}
                title="Đăng ký Phương cho tất cả Ca 1 và Ca 2"
              >
              </button> */}
      </>
    );
  }

  // Fallback return (shouldn't reach here)
  return null;
}

export default App;
