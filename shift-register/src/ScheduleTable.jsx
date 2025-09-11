import { useState, useEffect } from "react";
import { ref, set, onValue } from "firebase/database";
import { db } from "./firebase";
import toast from "react-hot-toast";

const ScheduleTable = ({ DAYS, SHIFTS, getShiftData, setShowScheduleTable, selectedWeek }) => {
  const [dailyRoles, setDailyRoles] = useState({});
  const [draggedEmployee, setDraggedEmployee] = useState(null);

  // Lắng nghe dữ liệu vai trò hàng ngày
  useEffect(() => {
    const unsubscribe = onValue(ref(db, `dailyRoles/${selectedWeek.id}`), (snapshot) => {
      const data = snapshot.val() || {};
      
      // Kiểm tra và xóa dữ liệu cũ có format array
      let hasOldData = false;
      Object.keys(data).forEach(dayKey => {
        const dayData = data[dayKey] || {};
        if (Array.isArray(dayData.keyKeepers) || Array.isArray(dayData.ketKeepers)) {
          hasOldData = true;
        }
      });
      
      // Nếu có dữ liệu cũ, xóa và reset
      if (hasOldData) {
        console.log('Detected old data format, clearing...');
        set(ref(db, `dailyRoles/${selectedWeek.id}`), {});
        setDailyRoles({});
        return;
      }
      
      // Dọn dẹp và chuẩn hóa dữ liệu
      const cleanedData = {};
      Object.keys(data).forEach(dayKey => {
        const dayData = data[dayKey] || {};
        
        // Xử lý keyKeeper
        let keyKeeper = '';
        if (typeof dayData.keyKeeper === 'string') {
          keyKeeper = dayData.keyKeeper;
        }
        
        // Xử lý ketKeepers
        let ketKeepers = { shift0: '', shift1: '', shift2: '' };
        if (dayData.ketKeepers && typeof dayData.ketKeepers === 'object' && !Array.isArray(dayData.ketKeepers)) {
          ketKeepers = {
            shift0: dayData.ketKeepers.shift0 || '',
            shift1: dayData.ketKeepers.shift1 || '',
            shift2: dayData.ketKeepers.shift2 || ''
          };
        }
        
        cleanedData[dayKey] = {
          keyKeeper,
          ketKeepers
        };
      });
      
      setDailyRoles(cleanedData);
    });
    return () => unsubscribe();
  }, [selectedWeek.id]);

  // Lấy vai trò của một ngày cụ thể
  const getDayRoles = (dayIndex) => {
    const dayKey = `day${dayIndex}`;
    const roles = dailyRoles[dayKey];
    
    if (!roles) {
      return {
        keyKeeper: '',
        ketKeepers: { shift0: '', shift1: '', shift2: '' }
      };
    }
    
    return roles;
  };

  // Bắt đầu kéo button vai trò
  const handleDragStart = (e, roleType) => {
    setDraggedEmployee(roleType); // Lưu loại vai trò đang được kéo
    e.dataTransfer.effectAllowed = 'move';
  };

  // Xử lý khi thả vai trò vào tên nhân viên
  const handleDrop = (e, employeeName, dayIndex, shiftIndex) => {
    e.preventDefault();
    if (draggedEmployee) {
      assignRole(dayIndex, employeeName, draggedEmployee, shiftIndex);
      setDraggedEmployee(null);
    }
  };

  // Cho phép drop
  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  // Gán vai trò cho nhân viên
  const assignRole = (dayIndex, employeeName, roleType, shiftIndex) => {
    const dayKey = `day${dayIndex}`;
    const currentDayRoles = dailyRoles[dayKey] || { 
      keyKeeper: '', // Chỉ 1 người giữ key ở ca 1
      ketKeepers: { shift0: '', shift1: '', shift2: '' } // Mỗi ca có 1 người giữ két
    };
    
    let updatedRoles = { ...currentDayRoles };
    
    if (roleType === 'key') {
      // Key chỉ cho Ca 1 (shiftIndex = 0)
      if (shiftIndex !== 0) {
        toast.error("Vai trò 'Key' chỉ được gán cho Ca 1.");
        return;
      }
      updatedRoles.keyKeeper = employeeName;
    } else if (roleType === 'ket') {
      // Két cho từng ca riêng biệt
      const shiftKey = `shift${shiftIndex}`;
      if (!updatedRoles.ketKeepers) {
        updatedRoles.ketKeepers = { shift0: '', shift1: '', shift2: '' };
      }
      updatedRoles.ketKeepers[shiftKey] = employeeName;
    }

    const updatedDailyRoles = {
      ...dailyRoles,
      [dayKey]: updatedRoles
    };

    setDailyRoles(updatedDailyRoles);
    set(ref(db, `dailyRoles/${selectedWeek.id}/${dayKey}`), updatedRoles);
  };

  return (
    <div className="calendar-container">
      <div className="overlay" onClick={() => setShowScheduleTable(false)}></div>
      <div className="schedule-content">
        {/* Phần drag buttons */}
        <div className="role-assignment-section">
          <div className="role-assignment-header">
            <h3>🔑 Phân công vai trò tuần {selectedWeek.label}</h3>
            <div className="drag-buttons">
              <button 
                className="drag-button key-button"
                draggable
                onDragStart={(e) => handleDragStart(e, 'key')}
              >
                🔑 Key
              </button>
              <button 
                className="drag-button ket-button"
                draggable
                onDragStart={(e) => handleDragStart(e, 'ket')}
              >
                🏦 Két
              </button>
            </div>
          </div>
          
          <p className="instruction-text">
            Kéo button "Key" hoặc "Két" vào tên nhân viên để gán vai trò
          </p>
        </div>

        {/* Bảng lịch làm việc */}
        <table>
          <thead>
            <tr className="header-row">
              <th colSpan={DAYS.length + 1} className="header-cell">
                Đăng ký lịch làm H384
              </th>
            </tr>
            <tr>
              <th colSpan="1" style={{ background: "#49BBC6" }}></th>
              {DAYS.map((day, index) => (
                <th key={index} className="day-header">
                  {day.name} ({day.date})
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SHIFTS.map((shift, shiftIndex) => (
              <tr key={shiftIndex}>
                <td className="ca-cell">
                  <div className="ca-title">{shift.name}</div>
                  <div className="ca-time">({shift.time})</div>
                </td>
                {DAYS.map((day, dayIndex) => {
                  const shiftData = getShiftData(dayIndex, shiftIndex);

                  return (
                    <td key={dayIndex}>
                      <div className="name-list">
                        {shiftData.map((name, nameIndex) => (
                          <span 
                            key={nameIndex} 
                            className="name-item droppable"
                            onDrop={(e) => handleDrop(e, name, dayIndex, shiftIndex)}
                            onDragOver={handleDragOver}
                          >
                            {name}
                            {(() => {
                              try {
                                const dayRoles = getDayRoles(dayIndex);
                                const roles = [];
                                
                                // Kiểm tra key (chỉ ở ca 1)
                                if (shiftIndex === 0 && dayRoles.keyKeeper === name) {
                                  roles.push('key');
                                }
                                
                                // Kiểm tra két (theo từng ca)
                                const shiftKey = `shift${shiftIndex}`;
                                if (dayRoles.ketKeepers && dayRoles.ketKeepers[shiftKey] === name) {
                                  roles.push('két');
                                }
                                
                                return roles.length > 0 ? (
                                  <span className="employee-roles"> ({roles.join(', ')})</span>
                                ) : null;
                              } catch (error) {
                                console.error('Error rendering roles:', error, { dayIndex, name, dailyRoles });
                                return null;
                              }
                            })()}
                          </span>
                        ))}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ScheduleTable;