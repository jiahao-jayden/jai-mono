print("Hello, World!") # 这是一个打印

# 变量 / 类型
name = "John" # 字符串
age = 20 # 整型
height = 1.75 # 浮点型
weight = 60
is_student = True # 布尔型 False

bmi = weight / height ** 2 # 19.59
print(bmi)

# 条件
if bmi < 18.5:
  print("过轻")
elif bmi < 24:
  print("正常")
else:
  print("过重")

print(bmi > 18.5)

# 循环
num = 0
while num < 10:
  num = num + 1

# 函数/方法
# def 函数名(参数1, 参数2, ...):
#   函数体
#   return 返回值
def add(a, b):
  return a + b

count = add(1,2)
print(add(1,2))
print(count)


def add1(a, b):
  c = a + b
print(add1(1,2)) # None
