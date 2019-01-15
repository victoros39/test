from turtle import Turtle

def init_drawman():
    global t, x_current, y_current
    t = Turtle()
    t.penup()
    x_current = 0
    y_current = 0
    t.goto(x_current, y_current)

def test_drawman():
    """
    Тестирование работы Чертежника
    :return: None
    """
    pen_down()
    for i in range(5):
        on_vector(10, 2)
        on_vector(0, -2)
    pen_up()
    to_point(0,0)



def pen_down():
    t.pendown()

def pen_up():
    t.penup()

def on_vector(dx, dy):
    global x_current, y_current
    x_current += dx
    y_current += dy
    t.goto(x_current, y_current)


def to_point(x,y):
    global x_current, y_current
    x_current = x
    y_current = y
    t.goto(x,y)



init_drawman()
if __name__ == '__main__':
    import time
    test_drawman()
    time.sleep(10)